#!/usr/bin/env python3
"""Anonymized aggregates from a loan-pipeline export, for the quarterly original-data posts.

Usage:  python3 -I scripts/data_post_stats.py <export.xlsx> [--since YYYY-MM-DD] > stats.json

Reads the 'Data' sheet, drops the address column immediately, and prints JSON of medians only.
Never prints an individual loan. Groups with fewer than MIN_N loans are omitted.
Expected columns: Purchase Price, Appraised Value, Loan Program, LTV, Loan Amount,
GFE Application Date, Est Closing Date, OS - Financing Contingency, Est Prepaids, Est Closing Costs,
Loan Estimate - Seller Credit Amount, Subject Property City, Subject Property State.
"""
import json, sys
import pandas as pd

MIN_N = 15
NUM = ['Purchase Price', 'Appraised Value', 'LTV', 'Loan Amount', 'Est Prepaids', 'Est Closing Costs',
       'Loan Estimate - Seller Credit Amount']
DATES = ['GFE Application Date', 'Est Closing Date', 'OS - Financing Contingency', 'OS - Appraisal Contingency']
CITY_FIX = {'Menomonee Fls': 'Menomonee Falls', 'Fond Du Lac': 'Fond du Lac'}


def program_group(s):
    s = str(s).upper()
    if 'WHEDA' in s: return 'WHEDA'
    if s.startswith('FHA'): return 'FHA'
    if s.startswith('VA'): return 'VA'
    if 'USDA' in s: return 'USDA'
    if s.startswith('EXPANDED'): return 'Non-QM'
    if s.startswith('CONV'): return 'Conventional'
    return 'Other'


def load(path):
    df = pd.read_excel(path, sheet_name='Data')
    df = df.drop(columns=[c for c in df.columns if 'Address' in c])
    for c in NUM:
        if c in df: df[c] = pd.to_numeric(df[c], errors='coerce')
    for c in DATES:
        if c in df: df[c] = pd.to_datetime(df[c], errors='coerce')
    df['grp'] = df['Loan Program'].map(program_group)
    df['city'] = df['Subject Property City'].replace(CITY_FIX)
    return df


def purchases(df):
    p = df['Loan Program'].str.upper()
    x = df[(df['Purchase Price'] > 0) & (~p.str.startswith('SECOND')) & (df['Subject Property State'] == 'WI')].copy()
    x = x[(x['Est Closing Costs'] > 500) & (x['Est Closing Costs'] < 30000)]
    x['days'] = (x['Est Closing Date'] - x['GFE Application Date']).dt.days
    x['sc'] = x['Loan Estimate - Seller Credit Amount'].fillna(0)
    x['gap'] = x['Appraised Value'] - x['Purchase Price']
    x['yr'] = x['Est Closing Date'].dt.year
    x['q'] = x['Est Closing Date'].dt.to_period('Q').astype(str)
    return x


def summ(g):
    if len(g) < MIN_N: return None
    sc = g.loc[g['sc'] > 0, 'sc']
    gap = g['gap'].dropna()
    r = lambda v: None if pd.isna(v) else round(float(v))
    return {
        'n': int(len(g)),
        'median_price': r(g['Purchase Price'].median()),
        'median_closing_costs': r(g['Est Closing Costs'].median()),
        'closing_costs_p25': r(g['Est Closing Costs'].quantile(.25)),
        'closing_costs_p75': r(g['Est Closing Costs'].quantile(.75)),
        'median_prepaids': r(g['Est Prepaids'].median()),
        'seller_credit_share_pct': round(float((g['sc'] > 0).mean() * 100)),
        'median_seller_credit_when_present': r(sc.median()) if len(sc) >= MIN_N else None,
        'median_days_app_to_close': r(g['days'].median()),
        'closed_within_21_days_pct': round(float((g['days'] <= 21).mean() * 100)),
        'closed_within_30_days_pct': round(float((g['days'] <= 30).mean() * 100)),
        'appraised_at_or_above_price_pct': round(float((gap >= 0).mean() * 100)) if len(gap) >= MIN_N else None,
        'median_appraisal_gap_when_below': r(gap[gap < 0].median()) if (gap < 0).sum() >= MIN_N else None,
    }


def by(x, col):
    out = {}
    for k, g in x.groupby(col):
        s = summ(g)
        if s: out[str(k)] = s
    return out


def main():
    path = sys.argv[1]
    since = None
    if '--since' in sys.argv: since = pd.Timestamp(sys.argv[sys.argv.index('--since') + 1])
    df = load(path)
    x = purchases(df)
    recent = x[x['Est Closing Date'] >= since] if since is not None else x[x['yr'] >= x['yr'].max() - 1]
    bands = pd.cut(recent['Purchase Price'], [0, 300e3, 400e3, 500e3, 1e9],
                   labels=['under_300k', '300k_400k', '400k_500k', '500k_plus'])
    out = {
        'source_rows': int(len(df)),
        'wi_purchases_total': int(len(x)),
        'date_range': [str(x['Est Closing Date'].min().date()), str(x['Est Closing Date'].max().date())],
        'recent_window': [str(recent['Est Closing Date'].min().date()), str(recent['Est Closing Date'].max().date())],
        'min_group_size': MIN_N,
        'recent_overall': summ(recent),
        'by_year': by(x, 'yr'),
        'by_quarter': by(x, 'q'),
        'recent_by_program': by(recent, 'grp'),
        'recent_by_price_band': by(recent.assign(band=bands), 'band'),
        'recent_by_city': by(recent, 'city'),
    }
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
