/* ============================================================
   Refined Mortgage Group — unified mortgage calculator
   Drop-in: <link rel="stylesheet" href="/styles/rmg-calc.css">
            <div data-rmg-calc></div>
            <script src="/styles/rmg-calc.js" defer></script>
   Optional attrs on the mount element:
     data-contact="/#contact"   where the "review my numbers" CTA points
   No dependencies. Educational estimates only.
   ============================================================ */
(function () {
  'use strict';

  var USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) { return (!isFinite(n) || n <= 0) ? '$0' : USD.format(Math.round(n)); }
  function money2(n) { return (!isFinite(n)) ? '$0' : USD.format(Math.round(n)); }

  /* ---------- finance helpers ---------- */
  function pmt(P, r, n) {
    if (n <= 0) return 0;
    if (r === 0) return P / n;
    return P * r / (1 - Math.pow(1 + r, -n));
  }

  // Estimated conventional monthly PMI factor by loan-to-value at origination.
  function pmiFactor(ltv) {
    if (ltv <= 0.80) return 0;
    if (ltv <= 0.85) return 0.0030;
    if (ltv <= 0.90) return 0.0042;
    if (ltv <= 0.95) return 0.0062;
    return 0.0085;
  }

  /* ---------- program fee rules ----------
     FHA annual MIP — HUD Mortgagee Letter 2023-05. Keyed on term
     (over vs. 15 years or less), the BASE loan amount, and LTV at
     origination. Returned as an annual decimal rate.                */
  function fhaAnnualRate(termMonths, baseLoan, ltv) {
    var big = baseLoan > 726200;
    if (termMonths > 180) {
      if (!big) return ltv > 0.95 ? 0.0055 : 0.0050;
      return ltv > 0.95 ? 0.0075 : 0.0070;
    }
    if (!big) return ltv > 0.90 ? 0.0040 : 0.0015;
    if (ltv <= 0.78) return 0.0015;
    if (ltv <= 0.90) return 0.0040;
    return 0.0065;
  }
  // FHA MIP runs 11 years when LTV at origination is 90% or less,
  // otherwise for the life of the loan. Not borrower-optional.
  function fhaMipEndMonth(ltv) { return ltv <= 0.90 ? 132 : null; }

  var FHA_UFMIP = 0.0175;

  // VA funding fee — VA.gov schedule effective April 7, 2023.
  function vaFundingFee(downPct, subsequentUse, exempt) {
    if (exempt) return 0;
    if (downPct >= 10) return 0.0125;
    if (downPct >= 5) return 0.0150;
    return subsequentUse ? 0.0330 : 0.0215;
  }

  var USDA_UPFRONT = 0.0100;   // guarantee fee, FY2026
  var USDA_ANNUAL = 0.0035;    // annual fee, life of loan

  // WHEDA Advantage with charter-level (reduced) MI coverage, available
  // when household income is at or below 80% of area median. These monthly
  // factors are ESTIMATES for 18/16/12/6% coverage — MI company rate cards
  // vary by score, DTI and provider.
  function whedaCharterFactor(ltv) {
    if (ltv <= 0.80) return 0;
    if (ltv <= 0.85) return 0.0016;
    if (ltv <= 0.90) return 0.0027;
    if (ltv <= 0.95) return 0.0036;
    return 0.0045;
  }

  /**
   * Month-by-month amortization.
   * o = { principal, rate(annual %), termMonths, price,
   *       extraMonthly, biweekly, lump, lumpMonth, lumpMode:'prepay'|'recast',
   *       mi: { mode:'none'|'flat'|'declining', rate, monthlyFlat, endMonth, cancelAt80 } }
   * `principal` is the TOTAL financed loan (base + any financed upfront fee).
   */
  function simulate(o) {
    var r = (o.rate / 100) / 12;
    var basePay = pmt(o.principal, r, o.termMonths);
    var pay = basePay;
    var bal = o.principal;
    var totalInterest = 0, totalPmi = 0, totalExtra = 0;
    var schedule = [{ m: 0, bal: bal, interest: 0, principal: 0 }];
    var recastPayment = null;
    var pmiEndsMonth = null;
    var mi = o.mi || { mode: 'none' };
    var miActive = mi.mode === 'flat' ? (mi.monthlyFlat > 0) : (mi.mode === 'declining' && mi.rate > 0);
    var miCur = mi.mode === 'flat' ? (mi.monthlyFlat || 0) : 0;
    var maxMonths = o.termMonths + 2;
    var m = 0;

    // Biweekly accelerator programs collect half a payment every two weeks =
    // 26 half payments = 13 monthly payments a year. Modeled as one extra
    // monthly payment spread across the year.
    var biweeklyExtra = o.biweekly ? basePay / 12 : 0;

    while (bal > 0.005 && m < maxMonths) {
      m++;

      // FHA / USDA charge on the average outstanding balance for each loan
      // year, so reset the monthly amount at the start of every year from the
      // balance the loan actually carries into it.
      if (mi.mode === 'declining' && (m - 1) % 12 === 0) miCur = (mi.rate || 0) * bal / 12;
      if (miActive && mi.endMonth && m > mi.endMonth) { miActive = false; pmiEndsMonth = mi.endMonth; }

      var interest = bal * r;
      var due = Math.min(pay, bal + interest);
      var princ = due - interest;
      bal -= princ;
      totalInterest += interest;

      // Mortgage insurance for this month
      if (miActive) {
        if (mi.cancelAt80 && bal <= o.price * 0.80) {
          miActive = false;
          pmiEndsMonth = m;
        } else {
          totalPmi += miCur;
        }
      }

      // extra principal
      var appliedExtra = 0;
      var extra = (o.extraMonthly || 0) + biweeklyExtra;
      if (extra > 0 && bal > 0) {
        var e = Math.min(extra, bal);
        bal -= e; totalExtra += e; appliedExtra += e;
      }

      // one-time lump sum
      if (o.lump > 0 && m === o.lumpMonth && bal > 0) {
        var l = Math.min(o.lump, bal);
        bal -= l; totalExtra += l; appliedExtra += l;
        if (o.lumpMode === 'recast') {
          // Re-amortize the new balance over the REMAINING original term:
          // same payoff date, lower payment.
          var remaining = o.termMonths - m;
          if (remaining > 0 && bal > 0) {
            pay = pmt(bal, r, remaining);
            recastPayment = pay;
          }
        }
      }

      schedule.push({ m: m, bal: Math.max(bal, 0), interest: interest, principal: princ + appliedExtra });
      if (bal <= 0.005) break;
    }

    return {
      basePayment: basePay,
      payment: pay,
      recastPayment: recastPayment,
      months: m,
      totalInterest: totalInterest,
      totalPmi: totalPmi,
      totalExtra: totalExtra,
      pmiEndsMonth: pmiEndsMonth,
      schedule: schedule
    };
  }

  function monthsLabel(n) {
    var y = Math.floor(n / 12), mo = n % 12;
    if (y && mo) return y + ' yr ' + mo + ' mo';
    if (y) return y + ' yr';
    return mo + ' mo';
  }
  function payoffDate(months) {
    var d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  /* ---------- markup ---------- */
  function field(id, label, prefix, suffix, value, attrs, extra) {
    return '<div class="rmgc-field"><label for="' + id + '">' + label + '</label><div class="rmgc-in">' +
      (prefix ? '<span>' + prefix + '</span>' : '') +
      '<input id="' + id + '" type="number" value="' + value + '" ' + (attrs || '') + '>' +
      (suffix ? '<span>' + suffix + '</span>' : '') + '</div>' + (extra || '') + '</div>';
  }
  function check(id, label, checked) {
    return '<label class="rmgc-check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span>' + label + '</span></label>';
  }

  var TEMPLATE = function (contact) { return '' +
  '<div class="rmgc-head">' +
    '<div><span class="rmgc-kicker">Run your numbers</span><h3>Mortgage payment calculator</h3></div>' +
    '<button type="button" class="rmgc-reset" id="rmgcReset">Reset</button>' +
  '</div>' +

  '<div class="rmgc-main">' +
    '<div>' +
      '<div class="rmgc-grid">' +
        '<div class="rmgc-field"><label for="rmgc_prod">Loan program</label><div class="rmgc-in"><select id="rmgc_prod">' +
          '<option value="conv">Conventional</option>' +
          '<option value="fha">FHA</option>' +
          '<option value="va">VA</option>' +
          '<option value="usda">USDA</option>' +
          '<option value="wheda">WHEDA</option>' +
        '</select></div></div>' +
        field('rmgc_price', 'Home price', '$', '', '350000', 'min="0" step="1000"') +
        field('rmgc_down', 'Down payment', '', '%', '10', 'min="0" max="100" step="0.5"', '<div class="rmgc-warn" id="rmgc_downwarn" hidden></div>') +
        field('rmgc_rate', 'Interest rate', '', '%', '6.5', 'min="0" max="25" step="0.01"') +
        '<div class="rmgc-field"><label for="rmgc_term">Loan term</label><div class="rmgc-in"><select id="rmgc_term"><option value="360">30 years</option><option value="240">20 years</option><option value="180">15 years</option><option value="120">10 years</option></select></div><div class="rmgc-warn" id="rmgc_termwarn" hidden></div></div>' +
        field('rmgc_tax', 'Property taxes <span class="rmgc-hint">/ yr</span>', '$', '', '6300', 'min="0" step="100"') +
        field('rmgc_ins', 'Home insurance <span class="rmgc-hint">/ yr</span>', '$', '', '1400', 'min="0" step="50"') +
        field('rmgc_hoa', 'HOA dues <span class="rmgc-hint">/ mo (optional)</span>', '$', '', '0', 'min="0" step="10"') +
      '</div>' +

      '<div class="rmgc-prod">' +
        '<div class="rmgc-opt rmgc-prodpanel" data-prod="fha">' +
          '<h4>FHA</h4>' +
          '<p class="rmgc-why">FHA charges 1.75% upfront (usually rolled into the loan) plus an annual premium built into the payment. Put 10% or more down and it ends after 11 years; under 10% it stays for the life of the loan &mdash; the usual exit is a refinance to conventional once you have 20% equity.</p>' +
          check('rmgc_fha_fin', 'Finance the upfront MIP into the loan', true) +
        '</div>' +

        '<div class="rmgc-opt rmgc-prodpanel" data-prod="va">' +
          '<h4>VA</h4>' +
          '<p class="rmgc-why">No down payment, no monthly mortgage insurance. Instead there is a one-time funding fee that most borrowers finance. Veterans receiving VA disability compensation are exempt.</p>' +
          '<div class="rmgc-grid">' +
            '<div class="rmgc-field"><label for="rmgc_va_use">Entitlement use</label><div class="rmgc-in"><select id="rmgc_va_use"><option value="first">First VA loan</option><option value="sub">Used VA before</option></select></div></div>' +
          '</div>' +
          check('rmgc_va_exempt', 'Exempt from funding fee (VA disability compensation, Purple Heart, DIC surviving spouse)', false) +
          check('rmgc_va_fin', 'Finance the funding fee into the loan', true) +
        '</div>' +

        '<div class="rmgc-opt rmgc-prodpanel" data-prod="usda">' +
          '<h4>USDA</h4>' +
          '<p class="rmgc-why">Zero down for homes in USDA-eligible areas with income under the area limit. A 1% guarantee fee is financed into the loan and a 0.35% annual fee is built into the payment for the life of the loan &mdash; cheaper than FHA\'s, but it never drops off.</p>' +
          '<p class="rmgc-why">Eligibility: the property has to sit in a USDA-eligible (rural) area and household income has to fall under the area limit &mdash; roughly 115% of area median. There is no loan limit, but there is an income limit. 30-year fixed only.</p>' +
          check('rmgc_usda_fin', 'Finance the upfront guarantee fee into the loan', true) +
        '</div>' +

        '<div class="rmgc-opt rmgc-prodpanel" data-prod="wheda">' +
          '<h4>WHEDA Advantage Conventional</h4>' +
          '<p class="rmgc-why">Wisconsin\'s housing authority. A 30-year conventional loan with income limits, a 620 minimum score, and &mdash; if your household is at or below 80% of area median income &mdash; noticeably cheaper mortgage insurance. Pair it with Easy Close down payment assistance (up to 6% of the price, repaid as a 10-year second mortgage) or Capital Access ($7,500 at 0% with no monthly payment). First-time buyers complete a homebuyer education course.</p>' +
          check('rmgc_wheda_ami', 'Household income at or below 80% of area median (reduced-coverage MI)', false) +
          '<div class="rmgc-grid">' +
            field('rmgc_wheda_dpa', 'Easy Close DPA amount <span class="rmgc-hint">up to 6% of price, min $1,000</span>', '$', '', '0', 'min="0" step="500"', '<div class="rmgc-warn" id="rmgc_dpawarn" hidden></div>') +
          '</div>' +
          '<p class="rmgc-why">A WHEDA Advantage FHA version also exists &mdash; not modeled here.</p>' +
        '</div>' +
      '</div>' +

      '<div class="rmgc-opts">' +
        '<div class="rmgc-opts-lbl">Add options</div>' +
        '<div class="rmgc-chips">' +
          '<button type="button" class="rmgc-chip" aria-pressed="false" data-opt="prepay"><span class="rmgc-tick"></span>Extra principal</button>' +
          '<button type="button" class="rmgc-chip" aria-pressed="false" data-opt="biweekly"><span class="rmgc-tick"></span>Biweekly payments</button>' +
          '<button type="button" class="rmgc-chip" aria-pressed="false" data-opt="recast"><span class="rmgc-tick"></span>Recast</button>' +
          '<button type="button" class="rmgc-chip" aria-pressed="false" data-opt="pmidrop"><span class="rmgc-tick"></span>PMI drop-off</button>' +
          '<button type="button" class="rmgc-chip" aria-pressed="false" data-opt="chart"><span class="rmgc-tick"></span>Payoff chart</button>' +
          '<button type="button" class="rmgc-chip" aria-pressed="false" data-opt="amort"><span class="rmgc-tick"></span>Amortization schedule</button>' +
        '</div>' +

        '<div class="rmgc-opt" data-panel="prepay">' +
          '<h4>Extra principal</h4>' +
          '<p class="rmgc-why">Every extra dollar goes straight at the balance, so you skip the interest it would have earned. Payment stays the same &mdash; the loan just ends sooner.</p>' +
          '<div class="rmgc-grid">' +
            field('rmgc_extra', 'Extra principal <span class="rmgc-hint">/ mo</span>', '$', '', '200', 'min="0" step="25"') +
          '</div>' +
        '</div>' +

        '<div class="rmgc-opt" data-panel="biweekly">' +
          '<h4>Biweekly payments</h4>' +
          '<p class="rmgc-why">Half a payment every two weeks is 26 half-payments &mdash; the equivalent of 13 monthly payments a year instead of 12. The extra one goes to principal.</p>' +
        '</div>' +

        '<div class="rmgc-opt" data-panel="recast">' +
          '<h4>Recast</h4>' +
          '<p class="rmgc-why">Put a lump sum against the balance, then the lender re-amortizes what is left over the <em>remaining</em> term. Same payoff date, permanently lower payment &mdash; no refinance, no new rate. Most servicers charge a small fee and require a minimum.</p>' +
          '<div class="rmgc-grid">' +
            field('rmgc_lump', 'Lump sum toward principal', '$', '', '25000', 'min="0" step="1000"') +
            field('rmgc_lumpm', 'Applied after', '', 'mo', '24', 'min="1" step="1"') +
          '</div>' +
        '</div>' +

        '<div class="rmgc-opt" data-panel="pmidrop">' +
          '<h4>PMI drop-off</h4>' +
          '<p class="rmgc-why">Mortgage insurance is not forever. Once the balance reaches 80% of the original value you can request it be removed, and it comes off automatically at 78%. Turn this on to stop charging PMI at that point instead of for the life of the loan.</p>' +
        '</div>' +

      '</div>' +
    '</div>' +

    '<div class="rmgc-result">' +
      '<div class="rmgc-sub">Estimated monthly payment</div>' +
      '<div class="rmgc-big" id="rmgc_total">&mdash;</div>' +
      '<div class="rmgc-rrow"><span>Principal &amp; interest</span><b id="rmgc_pi">&mdash;</b></div>' +
      '<div class="rmgc-rrow"><span>Property taxes</span><b id="rmgc_t">&mdash;</b></div>' +
      '<div class="rmgc-rrow"><span>Home insurance</span><b id="rmgc_i">&mdash;</b></div>' +
      '<div class="rmgc-rrow" id="rmgc_pmirow"><span><span id="rmgc_pmilbl">Est. mortgage insurance</span><small class="rmgc-minote" id="rmgc_minote" hidden></small></span><b id="rmgc_pmi">&mdash;</b></div>' +
      '<div class="rmgc-rrow" id="rmgc_dparow" style="display:none"><span>Easy Close DPA (2nd mortgage)</span><b id="rmgc_dpaout">&mdash;</b></div>' +
      '<div class="rmgc-rrow" id="rmgc_hoarow" style="display:none"><span>HOA dues</span><b id="rmgc_hoaout">&mdash;</b></div>' +
      '<div class="rmgc-rrow rmgc-muted"><span>Loan amount</span><b id="rmgc_loan">&mdash;</b></div>' +
      '<div class="rmgc-rrow rmgc-muted" id="rmgc_upfrontrow" style="display:none"><span>Upfront fee paid at closing</span><b id="rmgc_upfront">&mdash;</b></div>' +
      '<div class="rmgc-rrow rmgc-muted"><span>Payoff</span><b id="rmgc_payoff">&mdash;</b></div>' +

      '<div class="rmgc-savings" id="rmgc_sav">' +
        '<div class="rmgc-sav-lbl">With your options</div>' +
        '<div class="rmgc-rrow"><span>Interest saved</span><b id="rmgc_savint">&mdash;</b></div>' +
        '<div class="rmgc-rrow"><span>Time saved</span><b id="rmgc_savtime">&mdash;</b></div>' +
        '<div class="rmgc-rrow"><span>New payoff</span><b id="rmgc_savpay">&mdash;</b></div>' +
        '<div class="rmgc-rrow" id="rmgc_recastrow" style="display:none"><span>Payment after recast</span><b id="rmgc_recast">&mdash;</b></div>' +
      '</div>' +

      '<a class="rmgc-cta" id="rmgc_send" href="' + contact + '">Have Ethan check these numbers &rarr;</a>' +
      '<a class="rmgc-cta2" href="https://calendly.com/ethan-brooks/15min">or book a 15-minute call</a>' +
    '</div>' +
  '</div>' +

  '<div class="rmgc-extra">' +
    '<div class="rmgc-card" data-card="chart">' +
      '<h4>Balance over time</h4>' +
      '<div class="rmgc-cap" id="rmgc_chartcap">How fast the loan comes down.</div>' +
      '<div class="rmgc-legend" id="rmgc_legend"></div>' +
      '<div class="rmgc-chartwrap"><svg class="rmgc-chart" id="rmgc_svg" viewBox="0 0 760 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Loan balance over time"></svg></div>' +
    '</div>' +
    '<div class="rmgc-card" data-card="amort">' +
      '<h4>Amortization schedule</h4>' +
      '<div class="rmgc-cap">Totals per year, including any extra principal you have added.</div>' +
      '<div class="rmgc-tablewrap"><table class="rmgc-table"><thead><tr><th>Year</th><th>Payments</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead><tbody id="rmgc_amort"></tbody></table></div>' +
      '<p class="rmgc-amort-note">Principal &amp; interest only &mdash; taxes, insurance, and mortgage insurance are excluded from this table.</p>' +
    '</div>' +
  '</div>' +

  '<div class="rmgc-foot">' +
    '<p class="rmgc-note"><strong>Estimates only.</strong> Not a loan approval, a rate quote, a commitment to lend, or financial advice. Mortgage insurance is estimated from loan-to-value and varies by credit, program, and provider. Program fees (FHA MIP, VA funding fee, USDA guarantee fee) follow published agency schedules and may change. Taxes and insurance are your inputs. Recast availability, minimums, and fees are set by your servicer. Your actual numbers depend on your rate, program, and approval &mdash; ask me for a real scenario.</p>' +
    '<div class="rmgc-actions">' +
      '<a class="rmgc-btn rmgc-btn-lime" href="' + contact + '">Send Ethan my scenario &rarr;</a>' +
      '<a class="rmgc-btn rmgc-btn-ghost" href="https://mtgpro.co/dr/c/nroce">Start your application</a>' +
    '</div>' +
  '</div>';
  };

  /* ---------- chart ---------- */
  function drawChart(svg, series) {
    var W = 760, H = 300, PL = 62, PR = 16, PT = 14, PB = 32;
    var iw = W - PL - PR, ih = H - PT - PB;
    var maxM = 0, maxB = 0;
    series.forEach(function (s) {
      maxM = Math.max(maxM, s.data.length - 1);
      s.data.forEach(function (p) { maxB = Math.max(maxB, p.bal); });
    });
    if (maxM <= 0 || maxB <= 0) { svg.innerHTML = ''; return; }
    var x = function (m) { return PL + (m / maxM) * iw; };
    var y = function (b) { return PT + ih - (b / maxB) * ih; };
    var out = '';

    // gridlines + y labels
    for (var g = 0; g <= 4; g++) {
      var v = maxB * (1 - g / 4), yy = PT + (ih * g / 4);
      out += '<line class="rmgc-gl" x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + yy.toFixed(1) + '"/>';
      out += '<text x="' + (PL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + (v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$0') + '</text>';
    }
    // x labels (every 5 years)
    var years = Math.ceil(maxM / 12);
    var step = years > 20 ? 5 : (years > 10 ? 5 : 2);
    for (var yr = 0; yr <= years; yr += step) {
      var xx = x(Math.min(yr * 12, maxM));
      out += '<text x="' + xx.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + (yr === 0 ? 'Now' : 'Yr ' + yr) + '</text>';
    }
    // series
    series.forEach(function (s) {
      var d = '', stepN = Math.max(1, Math.floor(s.data.length / 400));
      for (var i = 0; i < s.data.length; i += stepN) {
        d += (i === 0 ? 'M' : 'L') + x(s.data[i].m).toFixed(1) + ' ' + y(s.data[i].bal).toFixed(1);
      }
      var last = s.data[s.data.length - 1];
      d += 'L' + x(last.m).toFixed(1) + ' ' + y(last.bal).toFixed(1);
      out += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.dash ? 2 : 3) + '" stroke-linecap="round" stroke-linejoin="round"' + (s.dash ? ' stroke-dasharray="6 5"' : '') + '/>';
      out += '<circle cx="' + x(last.m).toFixed(1) + '" cy="' + y(last.bal).toFixed(1) + '" r="4.5" fill="' + s.color + '"/>';
    });
    svg.innerHTML = out;
  }

  /* ---------- product metadata ---------- */
  var PRODUCTS = {
    conv:  { label: 'Conventional', down: 10,  minDown: 3,   fixedTerm: null, miLabel: 'Est. mortgage insurance', cancellable: true },
    fha:   { label: 'FHA',          down: 3.5, minDown: 3.5, fixedTerm: null, miLabel: 'FHA mortgage insurance (MIP)', cancellable: false },
    va:    { label: 'VA',           down: 0,   minDown: 0,   fixedTerm: null, miLabel: 'Mortgage insurance', cancellable: false },
    usda:  { label: 'USDA',         down: 0,   minDown: 0,   fixedTerm: 360,  miLabel: 'USDA annual fee', cancellable: false },
    wheda: { label: 'WHEDA',        down: 3,   minDown: 0,   fixedTerm: 360,  miLabel: 'Est. mortgage insurance', cancellable: true }
  };

  /* ---------- wire up one instance ---------- */
  function init(root) {
    var contact = root.getAttribute('data-contact') || '/#contact';
    root.classList.add('rmgc');
    root.innerHTML = TEMPLATE(contact);

    var $ = function (id) { return root.querySelector('#' + id); };
    var num = function (id) { var v = parseFloat($(id).value); return isFinite(v) ? v : 0; };
    var opts = { prepay: false, biweekly: false, recast: false, pmidrop: false, chart: false, amort: false };
    var DEFAULTS = { rmgc_price: 350000, rmgc_down: 10, rmgc_rate: 6.5, rmgc_tax: 6300, rmgc_ins: 1400, rmgc_hoa: 0, rmgc_extra: 200, rmgc_lump: 25000, rmgc_lumpm: 24, rmgc_wheda_dpa: 0 };
    var pmidropChip = root.querySelector('.rmgc-chip[data-opt="pmidrop"]');

    root.querySelectorAll('.rmgc-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var k = chip.getAttribute('data-opt');
        opts[k] = !opts[k];
        chip.setAttribute('aria-pressed', opts[k] ? 'true' : 'false');
        var panel = root.querySelector('[data-panel="' + k + '"]');
        if (panel) panel.classList.toggle('on', opts[k]);
        var card = root.querySelector('[data-card="' + k + '"]');
        if (card) card.classList.toggle('on', opts[k]);
        recalc();
      });
    });

    // Applies the product's typical down payment, term lock and panel.
    function applyProduct(prod, setDown) {
      var p = PRODUCTS[prod] || PRODUCTS.conv;
      if (setDown) $('rmgc_down').value = p.down;
      var term = $('rmgc_term');
      if (p.fixedTerm) {
        term.value = String(p.fixedTerm);
        term.disabled = true;
        $('rmgc_termwarn').hidden = false;
        $('rmgc_termwarn').textContent = p.label + ' is 30-year fixed only';
      } else {
        term.disabled = false;
        $('rmgc_termwarn').hidden = true;
        $('rmgc_termwarn').textContent = '';
      }
      root.querySelectorAll('.rmgc-prodpanel').forEach(function (el) {
        el.classList.toggle('on', el.getAttribute('data-prod') === prod);
      });
      // PMI drop-off only applies where the MI is actually cancellable.
      if (pmidropChip) {
        pmidropChip.hidden = !p.cancellable;
        if (!p.cancellable && opts.pmidrop) {
          opts.pmidrop = false;
          pmidropChip.setAttribute('aria-pressed', 'false');
          var pp = root.querySelector('[data-panel="pmidrop"]');
          if (pp) pp.classList.remove('on');
        }
      }
    }

    $('rmgc_prod').addEventListener('change', function () {
      applyProduct($('rmgc_prod').value, true);
      recalc();
    });

    $('rmgcReset').addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (id) { if ($(id)) $(id).value = DEFAULTS[id]; });
      $('rmgc_prod').value = 'conv';
      $('rmgc_term').value = '360';
      $('rmgc_fha_fin').checked = true;
      $('rmgc_va_use').value = 'first';
      $('rmgc_va_exempt').checked = false;
      $('rmgc_va_fin').checked = true;
      $('rmgc_usda_fin').checked = true;
      $('rmgc_wheda_ami').checked = false;
      root.querySelectorAll('.rmgc-chip').forEach(function (c) {
        var k = c.getAttribute('data-opt');
        opts[k] = false; c.setAttribute('aria-pressed', 'false');
        var p = root.querySelector('[data-panel="' + k + '"]'); if (p) p.classList.remove('on');
        var cd = root.querySelector('[data-card="' + k + '"]'); if (cd) cd.classList.remove('on');
      });
      applyProduct('conv', false);
      recalc();
    });

    function recalc() {
      var prod = $('rmgc_prod').value;
      var P = PRODUCTS[prod] || PRODUCTS.conv;
      var price = num('rmgc_price');
      var downPct = Math.min(Math.max(num('rmgc_down'), 0), 100);
      var rate = num('rmgc_rate');
      var term = parseInt($('rmgc_term').value, 10) || 360;
      var taxM = num('rmgc_tax') / 12;
      var insM = num('rmgc_ins') / 12;
      var hoaM = num('rmgc_hoa');
      var baseLoan = Math.max(price * (1 - downPct / 100), 0);
      var ltv = price > 0 ? baseLoan / price : 0;

      // ---- upfront program fee (charged on the BASE loan) ----
      var feeRate = 0, feeName = '', financed = false;
      if (prod === 'fha') { feeRate = FHA_UFMIP; feeName = 'UFMIP'; financed = $('rmgc_fha_fin').checked; }
      else if (prod === 'va') { feeRate = vaFundingFee(downPct, $('rmgc_va_use').value === 'sub', $('rmgc_va_exempt').checked); feeName = 'funding fee'; financed = $('rmgc_va_fin').checked; }
      else if (prod === 'usda') { feeRate = USDA_UPFRONT; feeName = 'guarantee fee'; financed = $('rmgc_usda_fin').checked; }
      var fee = baseLoan * feeRate;
      var loan = baseLoan + (financed ? fee : 0);

      // ---- mortgage insurance spec ----
      var mi = { mode: 'none', rate: 0, monthlyFlat: 0, endMonth: null, cancelAt80: false };
      var miFirst = 0, miNote = '';
      if (prod === 'conv') {
        var cf = pmiFactor(ltv);
        mi = { mode: cf > 0 ? 'flat' : 'none', rate: 0, monthlyFlat: baseLoan * cf / 12, endMonth: null, cancelAt80: false };
        miFirst = mi.monthlyFlat;
      } else if (prod === 'fha') {
        var fr = fhaAnnualRate(term, baseLoan, ltv);
        mi = { mode: 'declining', rate: fr, monthlyFlat: 0, endMonth: fhaMipEndMonth(ltv), cancelAt80: false };
        miFirst = fr * loan / 12;
        miNote = mi.endMonth ? 'Ends after 11 yrs' : 'For the life of the loan';
      } else if (prod === 'usda') {
        mi = { mode: 'declining', rate: USDA_ANNUAL, monthlyFlat: 0, endMonth: null, cancelAt80: false };
        miFirst = USDA_ANNUAL * loan / 12;
        miNote = 'For the life of the loan';
      } else if (prod === 'wheda') {
        var wf = $('rmgc_wheda_ami').checked ? whedaCharterFactor(ltv) : pmiFactor(ltv);
        mi = { mode: wf > 0 ? 'flat' : 'none', rate: 0, monthlyFlat: baseLoan * wf / 12, endMonth: null, cancelAt80: false };
        miFirst = mi.monthlyFlat;
      }
      function miFor(cancel) {
        return { mode: mi.mode, rate: mi.rate, monthlyFlat: mi.monthlyFlat, endMonth: mi.endMonth, cancelAt80: !!cancel && P.cancellable };
      }

      // ---- WHEDA Easy Close DPA: separate 10-year second mortgage ----
      var dpa = 0, dpaPay = 0;
      if (prod === 'wheda') {
        dpa = Math.max(num('rmgc_wheda_dpa'), 0);
        dpaPay = dpa > 0 ? pmt(dpa, (rate / 100) / 12, 120) : 0;
        var dpaWarn = $('rmgc_dpawarn');
        if (dpa > price * 0.06 && price > 0) {
          dpaWarn.hidden = false;
          dpaWarn.textContent = 'WHEDA caps Easy Close at 6% of the price (' + money(price * 0.06) + ')';
        } else { dpaWarn.hidden = true; dpaWarn.textContent = ''; }
      }

      // ---- down payment minimum warning ----
      var dw = $('rmgc_downwarn');
      if (prod === 'conv' && downPct < 3) { dw.hidden = false; dw.textContent = 'Conventional loans need at least 3% down'; }
      else if (prod === 'fha' && downPct < 3.5) { dw.hidden = false; dw.textContent = 'FHA needs at least 3.5% down'; }
      else { dw.hidden = true; dw.textContent = ''; }

      var base = { principal: loan, rate: rate, termMonths: term, price: price, extraMonthly: 0, biweekly: false, lump: 0, lumpMonth: 0, lumpMode: 'prepay', mi: miFor(false) };
      var baseline = simulate(base);

      var scen = {
        principal: loan, rate: rate, termMonths: term, price: price,
        extraMonthly: opts.prepay ? num('rmgc_extra') : 0,
        biweekly: opts.biweekly,
        lump: opts.recast ? num('rmgc_lump') : 0,
        lumpMonth: opts.recast ? Math.max(1, Math.round(num('rmgc_lumpm'))) : 0,
        lumpMode: 'recast',
        mi: miFor(opts.pmidrop)
      };
      var hasOpts = opts.prepay || opts.biweekly || opts.recast || opts.pmidrop;
      var s = hasOpts ? simulate(scen) : baseline;

      // Headline is what you pay TODAY. A recast lowers the payment only from
      // the month the lump sum lands, so it is reported in the savings block.
      var pi = baseline.basePayment;
      var extraShown = opts.prepay ? num('rmgc_extra') : 0;
      var biShown = opts.biweekly ? baseline.basePayment / 12 : 0;
      var total = pi + taxM + insM + hoaM + (miFirst > 0 ? miFirst : 0) + dpaPay + extraShown + biShown;

      $('rmgc_total').textContent = money(total);
      $('rmgc_pi').textContent = money(pi) + (extraShown + biShown > 0 ? ' + ' + money(extraShown + biShown) : '');
      $('rmgc_t').textContent = money(taxM);
      $('rmgc_i').textContent = money(insM);
      $('rmgc_pmilbl').textContent = P.miLabel;
      if (prod === 'va') $('rmgc_pmi').textContent = 'None (VA)';
      else if (miFirst > 0) $('rmgc_pmi').textContent = money(miFirst);
      else $('rmgc_pmi').textContent = prod === 'conv' || prod === 'wheda' ? 'None (20%+ down)' : 'None';
      $('rmgc_minote').hidden = !miNote || miFirst <= 0;
      $('rmgc_minote').textContent = miNote;
      $('rmgc_pmirow').style.display = '';
      $('rmgc_dparow').style.display = dpaPay > 0 ? '' : 'none';
      $('rmgc_dpaout').textContent = money(dpaPay);
      $('rmgc_hoarow').style.display = hoaM > 0 ? '' : 'none';
      $('rmgc_hoaout').textContent = money(hoaM);
      $('rmgc_loan').textContent = (financed && fee > 0)
        ? money(baseLoan) + ' + ' + money(fee) + ' fee = ' + money(loan) + ' · ' + Math.round(ltv * 100) + '% LTV'
        : money(loan) + ' · ' + Math.round(ltv * 100) + '% LTV';
      $('rmgc_upfrontrow').style.display = (fee > 0 && !financed) ? '' : 'none';
      $('rmgc_upfront').textContent = money(fee);
      $('rmgc_payoff').textContent = loan > 0 ? (payoffDate(s.months) + ' · ' + monthsLabel(s.months)) : 'No loan — paid in cash';

      var intSaved = baseline.totalInterest - s.totalInterest;
      var pmiSaved = baseline.totalPmi - s.totalPmi;
      var timeSaved = baseline.months - s.months;
      var showSav = hasOpts && (intSaved > 1 || pmiSaved > 1 || timeSaved > 0 || s.recastPayment);
      $('rmgc_sav').classList.toggle('on', !!showSav);
      if (showSav) {
        $('rmgc_savint').textContent = money(intSaved + pmiSaved) + (pmiSaved > 1 ? ' (incl. MI)' : '');
        $('rmgc_savtime').textContent = timeSaved > 0 ? monthsLabel(timeSaved) + ' earlier' : 'Same payoff date';
        $('rmgc_savpay').textContent = payoffDate(s.months);
        $('rmgc_recastrow').style.display = (opts.recast && s.recastPayment) ? '' : 'none';
        if (s.recastPayment) {
          $('rmgc_recast').textContent = money(s.recastPayment) + ' (was ' + money(baseline.basePayment) + ')';
        }
      }

      // prefill the contact form with this scenario
      var progLine = '• Program: ' + P.label;
      if (fee > 0) progLine += ' (' + feeName + ' ' + money(fee) + ', ' + (financed ? 'financed' : 'paid at closing') + ')';
      if (prod === 'va' && feeRate === 0) progLine += ' (funding fee exempt)';
      var msg = 'I ran these numbers on your calculator and would like a real scenario:\n' +
        progLine + '\n' +
        '• Home price: ' + money(price) + '\n' +
        '• Down payment: ' + downPct + '% (' + money(price - baseLoan) + ')\n' +
        '• Loan amount: ' + money(loan) + '\n' +
        (dpa > 0 ? '• WHEDA Easy Close DPA: ' + money(dpa) + ' (' + money(dpaPay) + '/mo, 10-yr second)\n' : '') +
        '• Rate used: ' + rate + '% · ' + (term / 12) + '-year\n' +
        '• Estimated payment: ' + money(total) + '/mo\n' +
        (hasOpts ? '• Options: ' + Object.keys(opts).filter(function (k) { return opts[k] && k !== 'chart' && k !== 'amort'; }).join(', ') + '\n' : '') +
        '\nWhat would this actually look like for me?';
      var base2 = contact.split('#')[0];
      var hash = contact.split('#')[1] || 'contact';
      $('rmgc_send').setAttribute('href', base2 + (base2.indexOf('?') > -1 ? '&' : '?') + 'scenario=' + encodeURIComponent(msg) + '#' + hash);
      var footCta = root.querySelector('.rmgc-btn-lime');
      if (footCta) footCta.setAttribute('href', $('rmgc_send').getAttribute('href'));

      // chart
      if (opts.chart) {
        var series = [];
        if (hasOpts) {
          series.push({ data: baseline.schedule, color: '#9AAFA1', dash: true, label: 'Baseline' });
          series.push({ data: s.schedule, color: '#06694A', dash: false, label: 'With your options' });
        } else {
          series.push({ data: baseline.schedule, color: '#06694A', dash: false, label: 'Your loan' });
        }
        drawChart($('rmgc_svg'), series);
        $('rmgc_legend').innerHTML = series.map(function (x) {
          return '<span><i style="background:' + x.color + '"></i>' + x.label + '</span>';
        }).join('');
        $('rmgc_chartcap').textContent = hasOpts
          ? 'Dashed is the loan as written; solid is the loan with your options switched on.'
          : 'How fast the balance comes down over the life of the loan.';
      }

      // amortization
      if (opts.amort) {
        var rows = '', yr = 0, ai = 0, ap = 0, apay = 0, endBal = loan;
        for (var i = 1; i < s.schedule.length; i++) {
          var row = s.schedule[i];
          ai += row.interest; ap += row.principal; apay++;
          endBal = row.bal;
          if (i % 12 === 0 || i === s.schedule.length - 1) {
            yr++;
            rows += '<tr' + (endBal <= 0.01 ? ' class="rmgc-paid"' : '') + '><td>Year ' + yr + '</td><td>' + apay + '</td><td>' + money2(ai) + '</td><td>' + money2(ap) + '</td><td>' + (endBal <= 0.01 ? 'Paid off' : money2(endBal)) + '</td></tr>';
            ai = 0; ap = 0; apay = 0;
          }
        }
        $('rmgc_amort').innerHTML = rows;
      }
    }

    root.addEventListener('input', function (e) {
      if (e.target.matches('input,select')) recalc();
    });
    root.addEventListener('change', function (e) {
      if (e.target.matches('input,select')) recalc();
    });
    applyProduct('conv', false);
    recalc();
  }

  function boot() {
    document.querySelectorAll('[data-rmg-calc]').forEach(init);
  }

  /* Node/test surface — the browser path below is unchanged. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pmt: pmt,
      simulate: simulate,
      pmiFactor: pmiFactor,
      fhaAnnualRate: fhaAnnualRate,
      fhaMipEndMonth: fhaMipEndMonth,
      vaFundingFee: vaFundingFee,
      whedaCharterFactor: whedaCharterFactor,
      FHA_UFMIP: FHA_UFMIP,
      USDA_UPFRONT: USDA_UPFRONT,
      USDA_ANNUAL: USDA_ANNUAL,
      PRODUCTS: PRODUCTS
    };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
