/*
 * 空き家を「①放置する ②解体して更地で持つ ③今売る」で比べる計算ツール。
 *
 * 【この計算がしていること】
 * 1. その市区町村の実際の㎡単価から、土地のだいたいの時価を出す
 * 2. そこから固定資産税の評価額を推定する（公示価格の7割が目安）
 * 3. 住宅用地特例が「効いている場合」と「外れた場合」の税金を、5年ぶん積み上げる
 * 4. 解体費・管理費を足して、3つの選択肢を金額で並べる
 *
 * 【いちばん大事な点】
 * 特例が外れても税金はいきなり6倍にならない。地方税法の負担調整措置により、
 * 課税標準は1年に評価額の5%ずつしか上がらず、評価額の60%で止まる。
 * ここを正しく計算しているのがこのツールの中身。
 *
 * 【入力は送信していない】
 * すべてこのページの中だけで計算している。サーバーには何も送っていない。
 */

(function () {
  "use strict";

  var cfgEl = document.getElementById("calcConfig");
  if (!cfgEl) return;
  var C = JSON.parse(cfgEl.textContent);

  var YEARS = 5; // 比べる期間

  // 金額を「1,234万円」の形にする
  function yen(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    n = Math.round(n);
    var sign = n < 0 ? "−" : "";
    n = Math.abs(n);
    if (n >= 100000000) return sign + (n / 100000000).toFixed(2) + "億円";
    if (n >= 10000) return sign + Math.round(n / 10000).toLocaleString() + "万円";
    return sign + n.toLocaleString() + "円";
  }

  // 住宅用地特例が効いているときの、1年分の税額（固定資産税＋都市計画税）
  function taxWithSpecial(assessed, landSqm) {
    if (assessed <= 0 || landSqm <= 0) return 0;
    var unit = assessed / landSqm;
    var small = Math.min(landSqm, C.smallLimit);         // 200㎡までの部分
    var large = Math.max(0, landSqm - C.smallLimit);     // 200㎡を超える部分
    var fixed = (unit * small * C.specialSmallFixed + unit * large * C.specialLargeFixed) * C.taxRateFixed;
    var city = (unit * small * C.specialSmallCity + unit * large * C.specialLargeCity) * C.taxRateCity;
    return fixed + city;
  }

  // 特例が外れたあと、年ごとに税額がどう上がるかの配列を返す
  // 🔴 ここが「6倍にならない」理由の本体（地方税法 附則18条・25条）
  function taxSeriesAfterRevocation(assessed, landSqm, years) {
    if (assessed <= 0 || landSqm <= 0) return [];
    var unit = assessed / landSqm;
    var small = Math.min(landSqm, C.smallLimit);
    var large = Math.max(0, landSqm - C.smallLimit);
    // スタート地点＝特例が効いていたときの課税標準の割合
    var rFixed = (unit * small * C.specialSmallFixed + unit * large * C.specialLargeFixed) / assessed;
    var rCity = (unit * small * C.specialSmallCity + unit * large * C.specialLargeCity) / assessed;

    var out = [];
    for (var i = 0; i < years; i++) {
      rFixed = Math.min(rFixed + C.burdenStep, C.burdenCap); // 1年に評価額の5%ずつ
      rCity = Math.min(rCity + C.burdenStep, C.burdenCap);   // 上限は評価額の60%
      out.push(assessed * rFixed * C.taxRateFixed + assessed * rCity * C.taxRateCity);
    }
    return out;
  }

  function sum(arr) {
    return arr.reduce(function (a, b) { return a + b; }, 0);
  }

  function demolition(structure, floorSqm) {
    var range = C.demolition[structure] || C.demolition["木造"];
    var tsubo = floorSqm / C.tsubo;
    return [
      Math.round(tsubo * range[0] + C.disposal[0]),
      Math.round(tsubo * range[1] + C.disposal[1])
    ];
  }

  function calc() {
    var landSqm = Math.max(1, parseFloat(document.getElementById("landSqm").value) || 0);
    var floorSqm = Math.max(1, parseFloat(document.getElementById("floorSqm").value) || 0);
    var structure = document.getElementById("structure").value;
    var advised = document.getElementById("advised").checked;

    var out = document.getElementById("result");

    if (!C.landUnitPrice) {
      out.innerHTML = '<p class="warn"><span class="mark">⚠ 注意</span> ' +
        'この市区町村は土地の成約データが少ないため、金額の計算ができません。</p>';
      return;
    }

    // 1. 土地のだいたいの時価 → 固定資産税の評価額（公示価格の7割が目安）
    var landValue = C.landUnitPrice * landSqm;
    var assessed = landValue * C.assessedRatio;

    // 2. 5年分の税金
    var taxKeep = taxWithSpecial(assessed, landSqm);          // 特例が効いている場合の1年分
    var taxLeaveSeries = advised
      ? taxSeriesAfterRevocation(assessed, landSqm, YEARS)     // 勧告あり＝特例が外れる
      : new Array(YEARS).fill(taxKeep);                        // 勧告なし＝特例のまま
    // 解体して更地にすると、住宅用地でなくなるので勧告の有無に関係なく特例は外れる
    var taxDemolishSeries = taxSeriesAfterRevocation(assessed, landSqm, YEARS);

    var tax1 = sum(taxLeaveSeries);
    var tax2 = sum(taxDemolishSeries);

    // 3. 管理費（放置＝建物があるぶん手がかかる／更地＝草刈り中心で軽い）
    var maint1 = ((C.maintenance[0] + C.maintenance[1]) / 2) * YEARS;
    var maint2 = C.maintenance[0] * YEARS;

    // 4. 解体費
    var dem = demolition(structure, floorSqm);

    // 5. 今売った場合に入る金額（この市区町村の実成約の中央値を目安に使う）
    var sellNow = C.houseMedian || landValue;

    var cost1 = tax1 + maint1;
    var cost2low = dem[0] + tax2 + maint2;
    var cost2high = dem[1] + tax2 + maint2;

    var gap = sellNow + cost1; // ③今売る と ①放置 の、5年後の現金の差

    var advisedNote = advised
      ? '<p class="note">勧告を受けているため、住宅用地特例が外れた場合の税額で計算しています。' +
        'この土地（' + landSqm + '㎡）だと、<strong>固定資産税と都市計画税の合計で</strong>' +
        '1年目は約' + (taxLeaveSeries[0] / taxKeep).toFixed(2) + '倍、5年目は約' +
        (taxLeaveSeries[4] / taxKeep).toFixed(2) + '倍です。' +
        'よく言われる「6倍」にはなりません（地方税法 附則第18条・第25条の負担調整措置があるため）。</p>'
      : '<p class="note">勧告を受けていない前提で計算しています。' +
        '上のチェックを入れると、特例が外れた場合の金額に切り替わります。</p>';

    out.innerHTML =
      '<h4>5年間で比べると</h4>' +
      '<table class="cmp"><thead><tr><th>選択肢</th><th>5年間のお金の動き</th></tr></thead><tbody>' +

      '<tr><th><span class="opt">① 放置</span><br><span class="sub">そのまま持ち続ける</span></th>' +
      '<td><strong class="minus">−' + yen(cost1) + '</strong>' +
      '<span class="sub">出ていくお金（税金 ' + yen(tax1) + '＋管理費 ' + yen(maint1) + '）</span></td></tr>' +

      '<tr><th><span class="opt">② 解体</span><br><span class="sub">更地にして持ち続ける</span></th>' +
      '<td><strong class="minus">−' + yen(cost2low) + ' 〜 −' + yen(cost2high) + '</strong>' +
      '<span class="sub">解体費 ' + yen(dem[0]) + '〜' + yen(dem[1]) +
      '＋税金 ' + yen(tax2) + '＋管理費 ' + yen(maint2) + '</span></td></tr>' +

      '<tr class="best"><th><span class="opt">③ 売る</span><br><span class="sub">いま手放す</span></th>' +
      '<td><strong class="plus">＋' + yen(sellNow) + '</strong>' +
      '<span class="sub">' + C.cityName + 'で成約した中古戸建のまん中の価格。以後の税金・管理費はかかりません</span></td></tr>' +

      '</tbody></table>' +

      '<p class="gap"><span class="mark">◆ 差額</span> ' +
      '<strong>①放置</strong>と<strong>③売る</strong>では、5年後の手元のお金が約 <strong class="big">' +
      yen(gap) + '</strong> 違います。</p>' +

      advisedNote +

      '<details><summary>計算の中身を見る</summary>' +
      '<ul class="calcdetail">' +
      '<li>土地のだいたいの時価：' + yen(landValue) + '（' + C.cityName + 'の実成約の㎡単価 ' +
      yen(C.landUnitPrice) + ' × ' + landSqm + '㎡）</li>' +
      '<li>固定資産税の評価額（推定）：' + yen(assessed) + '（時価の' + Math.round(C.assessedRatio * 100) + '%が目安）</li>' +
      '<li>いまの年間の税金（特例あり）：' + yen(taxKeep) + '</li>' +
      '<li>特例が外れた場合の年ごとの税金：' +
      taxDemolishSeries.map(function (t, i) { return (i + 1) + '年目 ' + yen(t); }).join(' ／ ') + '</li>' +
      '<li>建物の固定資産税は、建物の評価額がわからないため計算に入れていません（実際はこれが別途かかります）</li>' +
      '</ul></details>';
  }

  ["landSqm", "floorSqm", "structure", "advised"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", calc);
    if (el) el.addEventListener("change", calc);
  });

  calc();
})();
