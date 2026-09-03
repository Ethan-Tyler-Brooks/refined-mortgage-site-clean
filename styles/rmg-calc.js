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

  /**
   * Month-by-month amortization.
   * o = { principal, rate(annual %), termMonths, price,
   *       extraMonthly, biweekly, lump, lumpMonth, lumpMode:'prepay'|'recast',
   *       pmiMonthly, pmiDrop }
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
    var pmiActive = o.pmiMonthly > 0;
    var maxMonths = o.termMonths + 2;
    var m = 0;

    // Biweekly accelerator programs collect half a payment every two weeks =
    // 26 half payments = 13 monthly payments a year. Modeled as one extra
    // monthly payment spread across the year.
    var biweeklyExtra = o.biweekly ? basePay / 12 : 0;

    while (bal > 0.005 && m < maxMonths) {
      m++;
      var interest = bal * r;
      var due = Math.min(pay, bal + interest);
      var princ = due - interest;
      bal -= princ;
      totalInterest += interest;

      // PMI for this month (charged while the loan is above the drop-off point)
      if (pmiActive) {
        if (o.pmiDrop && bal <= o.price * 0.80) {
          pmiActive = false;
          pmiEndsMonth = m;
        } else {
          totalPmi += o.pmiMonthly;
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
  function field(id, label, prefix, suffix, value, attrs) {
    return '<div class="rmgc-field"><label for="' + id + '">' + label + '</label><div class="rmgc-in">' +
      (prefix ? '<span>' + prefix + '</span>' : '') +
      '<input id="' + id + '" type="number" value="' + value + '" ' + (attrs || '') + '>' +
      (suffix ? '<span>' + suffix + '</span>' : '') + '</div></div>';
  }

  var TEMPLATE = function (contact) { return '' +
  '<div class="rmgc-head">' +
    '<div><span class="rmgc-kicker">Run your numbers</span><h3>Mortgage payment calculator</h3></div>' +
    '<button type="button" class="rmgc-reset" id="rmgcReset">Reset</button>' +
  '</div>' +

  '<div class="rmgc-main">' +
    '<div>' +
      '<div class="rmgc-grid">' +
        field('rmgc_price', 'Home price', '$', '', '350000', 'min="0" step="1000"') +
        field('rmgc_down', 'Down payment', '', '%', '10', 'min="0" max="100" step="0.5"') +
        field('rmgc_rate', 'Interest rate', '', '%', '6.5', 'min="0" max="25" step="0.01"') +
        '<div class="rmgc-field"><label for="rmgc_term">Loan term</label><div class="rmgc-in"><select id="rmgc_term"><option value="360">30 years</option><option value="240">20 years</option><option value="180">15 years</option><option value="120">10 years</option></select></div></div>' +
        field('rmgc_tax', 'Property taxes <span class="rmgc-hint">/ yr</span>', '$', '', '6300', 'min="0" step="100"') +
        field('rmgc_ins', 'Home insurance <span class="rmgc-hint">/ yr</span>', '$', '', '1400', 'min="0" step="50"') +
        field('rmgc_hoa', 'HOA dues <span class="rmgc-hint">/ mo (optional)</span>', '$', '', '0', 'min="0" step="10"') +
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
      '<div class="rmgc-rrow" id="rmgc_pmirow"><span>Est. mortgage insurance</span><b id="rmgc_pmi">&mdash;</b></div>' +
      '<div class="rmgc-rrow" id="rmgc_hoarow" style="display:none"><span>HOA dues</span><b id="rmgc_hoaout">&mdash;</b></div>' +
      '<div class="rmgc-rrow rmgc-muted"><span>Loan amount</span><b id="rmgc_loan">&mdash;</b></div>' +
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
    '<p class="rmgc-note"><strong>Estimates only.</strong> Not a loan approval, a rate quote, a commitment to lend, or financial advice. Mortgage insurance is estimated from loan-to-value and varies by credit, program, and provider. Taxes and insurance are your inputs. Recast availability, minimums, and fees are set by your servicer. Your actual numbers depend on your rate, program, and approval &mdash; ask me for a real scenario.</p>' +
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

  /* ---------- wire up one instance ---------- */
  function init(root) {
    var contact = root.getAttribute('data-contact') || '/#contact';
    root.classList.add('rmgc');
    root.innerHTML = TEMPLATE(contact);

    var $ = function (id) { return root.querySelector('#' + id); };
    var num = function (id) { var v = parseFloat($(id).value); return isFinite(v) ? v : 0; };
    var opts = { prepay: false, biweekly: false, recast: false, pmidrop: false, chart: false, amort: false };
    var DEFAULTS = { rmgc_price: 350000, rmgc_down: 10, rmgc_rate: 6.5, rmgc_tax: 6300, rmgc_ins: 1400, rmgc_hoa: 0, rmgc_extra: 200, rmgc_lump: 25000, rmgc_lumpm: 24 };

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

    $('rmgcReset').addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (id) { if ($(id)) $(id).value = DEFAULTS[id]; });
      $('rmgc_term').value = '360';
      root.querySelectorAll('.rmgc-chip').forEach(function (c) {
        var k = c.getAttribute('data-opt');
        opts[k] = false; c.setAttribute('aria-pressed', 'false');
        var p = root.querySelector('[data-panel="' + k + '"]'); if (p) p.classList.remove('on');
        var cd = root.querySelector('[data-card="' + k + '"]'); if (cd) cd.classList.remove('on');
      });
      recalc();
    });

    function recalc() {
      var price = num('rmgc_price');
      var downPct = Math.min(Math.max(num('rmgc_down'), 0), 100);
      var rate = num('rmgc_rate');
      var term = parseInt($('rmgc_term').value, 10) || 360;
      var taxM = num('rmgc_tax') / 12;
      var insM = num('rmgc_ins') / 12;
      var hoaM = num('rmgc_hoa');
      var loan = Math.max(price * (1 - downPct / 100), 0);
      var ltv = price > 0 ? loan / price : 0;
      var pmiM = loan * pmiFactor(ltv) / 12;

      var base = { principal: loan, rate: rate, termMonths: term, price: price, extraMonthly: 0, biweekly: false, lump: 0, lumpMonth: 0, lumpMode: 'prepay', pmiMonthly: pmiM, pmiDrop: false };
      var baseline = simulate(base);

      var scen = {
        principal: loan, rate: rate, termMonths: term, price: price,
        extraMonthly: opts.prepay ? num('rmgc_extra') : 0,
        biweekly: opts.biweekly,
        lump: opts.recast ? num('rmgc_lump') : 0,
        lumpMonth: opts.recast ? Math.max(1, Math.round(num('rmgc_lumpm'))) : 0,
        lumpMode: 'recast',
        pmiMonthly: pmiM,
        pmiDrop: opts.pmidrop
      };
      var hasOpts = opts.prepay || opts.biweekly || opts.recast || opts.pmidrop;
      var s = hasOpts ? simulate(scen) : baseline;

      // Headline is what you pay TODAY. A recast lowers the payment only from
      // the month the lump sum lands, so it is reported in the savings block.
      var pi = baseline.basePayment;
      var extraShown = opts.prepay ? num('rmgc_extra') : 0;
      var biShown = opts.biweekly ? baseline.basePayment / 12 : 0;
      var total = pi + taxM + insM + hoaM + (pmiM > 0 ? pmiM : 0) + extraShown + biShown;

      $('rmgc_total').textContent = money(total);
      $('rmgc_pi').textContent = money(pi) + (extraShown + biShown > 0 ? ' + ' + money(extraShown + biShown) : '');
      $('rmgc_t').textContent = money(taxM);
      $('rmgc_i').textContent = money(insM);
      $('rmgc_pmi').textContent = pmiM > 0 ? money(pmiM) : 'None (20%+ down)';
      $('rmgc_pmirow').style.display = '';
      $('rmgc_hoarow').style.display = hoaM > 0 ? '' : 'none';
      $('rmgc_hoaout').textContent = money(hoaM);
      $('rmgc_loan').textContent = money(loan) + ' · ' + Math.round(ltv * 100) + '% LTV';
      $('rmgc_payoff').textContent = loan > 0 ? (payoffDate(s.months) + ' · ' + monthsLabel(s.months)) : 'No loan — paid in cash';

      var intSaved = baseline.totalInterest - s.totalInterest;
      var pmiSaved = baseline.totalPmi - s.totalPmi;
      var timeSaved = baseline.months - s.months;
      var showSav = hasOpts && (intSaved > 1 || pmiSaved > 1 || timeSaved > 0 || s.recastPayment);
      $('rmgc_sav').classList.toggle('on', !!showSav);
      if (showSav) {
        $('rmgc_savint').textContent = money(intSaved + pmiSaved) + (pmiSaved > 1 ? ' (incl. PMI)' : '');
        $('rmgc_savtime').textContent = timeSaved > 0 ? monthsLabel(timeSaved) + ' earlier' : 'Same payoff date';
        $('rmgc_savpay').textContent = payoffDate(s.months);
        $('rmgc_recastrow').style.display = (opts.recast && s.recastPayment) ? '' : 'none';
        if (s.recastPayment) {
          $('rmgc_recast').textContent = money(s.recastPayment) + ' (was ' + money(baseline.basePayment) + ')';
        }
      }

      // prefill the contact form with this scenario
      var msg = 'I ran these numbers on your calculator and would like a real scenario:\n' +
        '• Home price: ' + money(price) + '\n' +
        '• Down payment: ' + downPct + '% (' + money(price - loan) + ')\n' +
        '• Loan amount: ' + money(loan) + '\n' +
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
      if (e.target.matches('select')) recalc();
    });
    recalc();
  }

  function boot() {
    document.querySelectorAll('[data-rmg-calc]').forEach(init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
