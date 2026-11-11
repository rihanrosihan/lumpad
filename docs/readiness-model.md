# Lumpad readiness & load model — evidence and weights

This is the model behind the Readiness score and the load/HRV/sleep panels. It starts from the
"Athletic Performance & Readiness OS" spec and **changes weights, thresholds and formulas where the
literature (PubMed / Consensus) or this athlete's own validated data say otherwise**. Every number
in the app is tagged: `[COROS]` as published, `[calc]` my calculation, `[convention]` coaching
convention without outcome evidence, `[LITERATURE]` population prior, `[VALIDATED]` this athlete's data.

## 1. Ground rules (unchanged from the project)

1. The athlete's validated rules beat any composite score: **Sleep HR > 67 → no hard running** (100 % on 103+ nights,
   `[VALIDATED]`); **pain ≥ 2/10 → durability event**; HRV Reduced + quality → downgrade. These are implemented as
   **caps** on the score (the score can never say "go" when a gate says "no").
2. No commercial composite score is validated or transparent — 14 scores from 10 brands, none disclosed formulas
   (Doherty 2025, Translational Exercise Biomedicine). So this model is fully disclosed and every component is shown.
3. Individual baselines, not population cut-offs, wherever data allow (Plews 2013; Walsh 2021).

## 2. Composite readiness — weights (100 points)

| Pillar | Spec | **Lumpad** | Why changed |
|---|---|---|---|
| Musculoskeletal & subjective | 15 | **30** | Subjective measures reflect acute and chronic load with *superior sensitivity and consistency* to objective measures (Saw 2016, systematic review of 56 studies). Perceived fatigue tracked daily load most strongly (r = −0.51) while lnRMSSD was small (r = −0.24) (Thorpe 2015). This athlete's limiter is mechanical (MTSS, plantar, thigh, Achilles), and previous injury is the most consistent prospective risk factor (Malisoux 2015 HR 1.72; Burke 2023). |
| Autonomic (HRV, RHR) | 35 | **30** | HRV-guided training helps only by a small, mostly non-significant margin for performance (Manresa-Rocamora 2021; Düking 2021), though with fewer non-responders. Resting HR adds little (no effect in Manresa-Rocamora 2021). Useful, but not more useful than the athlete's own report. |
| Sleep | 25 | **20** | Habitual < 7 h raises infection risk and needs should be individualised; effects of 1–3 nights of partial restriction on performance remain unclear (Walsh 2021, 2021 consensus). |
| Load balance (ACWR, form, ramp, monotony) | 25 | **20** | ACWR–injury evidence is heterogeneous and methodologically criticised (Maupin 2020; Griffin 2020; Impellizzeri 2020); TSB bands are convention. Load is a *planning* signal more than a *this-morning* signal. |

**Phase adjustment** (heuristic, ±5 only): Taper / race week → Sleep 25, Load 15 (load metrics fall by design in a taper).
Peak → Load 25, Autonomic 25. All other phases use the base weights.

### Components (base weights)

| Pillar | Component | Pts | Scoring `[calc]` |
|---|---|---|---|
| Musculoskeletal & subjective (30) | Pain while running (0–10) | 10 | 0 → 10, 1 → 6, ≥ 2 → 0 **and cap 44** |
| | Tibia tenderness | 5 | no → 5, yes → 0 **and cap 64** |
| | Energy / perceived fatigue (1–5) | 6 | linear 1 → 0 … 5 → 6 |
| | Muscle soreness DOMS (1–5, 5 = none) | 4 | linear |
| | Hydration / fuelling (1–5) | 2 | linear |
| | Muscular load decay (body map) | 3 | 3 − worst region load (0–3) |
| Autonomic (30) | 7-day mean ln(HRV) vs 60-day SWC | 16 | within or above −0.5 SD → 16; linear to 0 at −2 SD |
| | Today's HRV vs 60-day mean | 5 | ≥ −1 SD → 5, below → 2 |
| | HRV CV % (7 d, ln) | 3 | ≤ personal 60-day mean CV + 1 SD → 3, else 0 |
| | Resting HR vs 30-day mean | 6 | ≤ +2 bpm → 6; linear to 0 at +6 bpm |
| Sleep (20) | Asleep time vs need | 10 | ≥ need → 10; linear to 0 at need − 2 h |
| | 14-day running sleep debt | 6 | ≤ 2 h → 6; linear to 0 at 8 h |
| | Sleep efficiency (asleep / in bed) | 4 | ≥ 90 % → 4; linear to 0 at 75 % |
| Load (20) | ACWR (EWMA) | 6 | 0.8–1.3 → 6; < 0.8 → 5; 1.3–1.5 → 3; > 1.5 → 0 |
| | Form as % of fitness | 6 | ≥ −10 % → 6; −10…−30 % → 4; < −30 % → 1 |
| | Weekly distance progression | 5 | < 10 % → 5; 10–30 % → 3; > 30 % → 0 (Nielsen 2014) |
| | Monotony (7 d) | 3 | ≤ 1.5 → 3; 1.5–2.0 → 1.5; > 2.0 → 0 (Foster 1998) |

**Missing data**: pillars are scored only from components that have data; the score is rescaled to the available
weight and the coverage is shown ("dari 72/100 poin data"). With < 60 points of data there is **no score**.

**Tiers** (`[convention]`, from the spec): 85–100 Prime · 65–84 Optimal · 45–64 Compromised · < 45 Depleted.

## 3. Load model

- Daily load = COROS Training Load per activity, summed per day `[COROS]` (internal load).
- Fitness `CTL_t = CTL_{t−1} + (L_t − CTL_{t−1})/42`; Fatigue `ATL_t = ATL_{t−1} + (L_t − ATL_{t−1})/7`;
  Form `TSB_t = CTL_{t−1} − ATL_{t−1}` — as the spec (Banister/Coggan EWMA). Seeded with the mean of the first 14 days.
- ACWR: **EWMA (ATL/CTL) by default**, because it is the more sensitive method in two systematic reviews
  (Griffin 2020; Maupin 2020); uncoupled rolling 7 : 28 as the alternative. 0.8–1.3 shown as the lowest-risk band
  `[LITERATURE]` (Gabbett 2016; Maupin 2020), with its critique (Impellizzeri 2020).
- **Form zones are relative** (TSB as % of CTL), changed from the spec's absolute ±5/15/30 bands: those bands assume
  a TSS scale, and COROS Training Load is not TSS. Bands: > +25 % transition · +5…+25 % fresh · −10…+5 % grey ·
  −30…−10 % productive · < −30 % overload `[convention, scaled]`.
- **Ramp**: the spec's "+5–7 CTL/week" bands are TSS convention. Replaced by **weekly running-distance progression**:
  > 30 % week-on-week was associated with distance-related injuries including medial tibial stress syndrome
  (HR 1.59, exploratory) in 874 novice runners (Nielsen 2014). CTL ramp is still shown, without bands.
- Monotony = mean / SD of the 7 daily loads; Strain = weekly load × monotony (Foster 1998). The commonly used
  2.0 threshold is shown as a guide; Foster found thresholds were individual.

## 4. HRV, RHR, sleep

- HRV corridor: **ln(HRV)**, 60-day mean **± 0.5 SD** (the smallest-worthwhile-change convention), 7-day rolling mean
  as the decision line (Plews 2013: use rolling averages and the individual "fingerprint"). Spec used ± 0.75 SD.
- CV % of 7-day ln(HRV); flagged when it rises while the 7-day mean falls (Plews 2013).
- Autonomic quadrant: 7 days of HRV z-score vs RHR z-score. The "suppressed HRV with low RHR" corner reflects HRV
  saturation / parasympathetic patterns described by Plews 2013 — descriptive, not diagnostic.
- Sleep: COROS "Total" **includes awake time**, so asleep = total − awake; efficiency = asleep / total.
  Need: default 8 h, editable (Walsh 2021: individualise). No load-based "dynamic need" — no evidence for a formula.
- Hypnogram and overnight HR-dip curve: **not shown** — the COROS MCP gives stage totals, not a stage timeline or a
  sleeping-HR stream.

## 5. Activity analytics

- Efficiency Factor = speed (m/min, grade-adjusted if COROS gives it) / average HR `[calc]`.
- Aerobic decoupling = EF first half vs second half by laps, steady runs only; 5 % / 7.5 % badges are
  `[convention]` (Friel), not outcome-validated.
- Intensity distribution uses a **3-zone model with a 70 / 30 benchmark** (≥ 70 % low intensity; Campos 2021,
  20 studies), changed from the spec's 80/20. Zones from VDOT paces per lap: Z1 slower than M pace, Z2 between M and T,
  Z3 faster than T `[calc, lap resolution]`.
- HR zones use % of the highest HR seen in your laps (an estimate — no lab max HR / LTHR available).
- Telemetry is per 1-km lap (the COROS MCP gives laps, not second-by-second streams).

## 6. Predictions & race

- Endurance-adjusted marathon: Tanda & Knechtle 2013 (recreational men, r = 0.81, valid 165–266 min):
  `T(min) = 11.03 + 98.46·e^(−0.0053·K) + 0.387·P + 0.1·e^(0.23·BF)` with K = mean weekly km (8 weeks) and P = mean
  training pace (s/km). BF % is optional (Profil); without it the BF term is omitted (valid for BF < ~15 %, Tanda 2015).
  Applied to the marathon only — no comparable model for 5K–HM.
- Heat: marathon times slow progressively from 5 to 25 °C WBGT, more for slower runners (Ely 2007). Jakarta race
  conditions are likely above the studied range, so no number is extrapolated.
- Carbohydrate loading: 10–12 g/kg/24 h for 36–48 h before events > 90 min (ACSM/AND/DC joint position, Thomas 2016,
  full text) × body mass from Profil (default 75.3 kg, the Omron value the project resolved to).
- Shoes: using more than one pair in parallel was protective (HR 0.61; Malisoux 2015). There is **no validated
  lifespan in km**: lifespan targets are editable conventions.

## References (verified on PubMed / Consensus, Nov 2026)

- Saw AE, Main LC, Gastin PB. Br J Sports Med 2016;50:281-91. PMID 26423706. doi:10.1136/bjsports-2015-094758
- Thorpe RT et al. Int J Sports Physiol Perform 2015;10:958-64. PMID 25710257. doi:10.1123/ijspp.2015-0004
- Plews DJ et al. Sports Med 2013;43:773-81. PMID 23852425. doi:10.1007/s40279-013-0071-8
- Walsh NP et al. Br J Sports Med 2021 (2020 online). PMID 33144349. doi:10.1136/bjsports-2020-102025
- Foster C. Med Sci Sports Exerc 1998;30:1164-8. PMID 9662690. doi:10.1097/00005768-199807000-00023
- Nielsen RØ et al. J Orthop Sports Phys Ther 2014;44:739-47. PMID 25155475. doi:10.2519/jospt.2014.5164
- Gabbett TJ. Br J Sports Med 2016. PMID 26758673
- Impellizzeri FM et al. Int J Sports Physiol Perform 2020. PMID 32502973
- Maupin D et al. Open Access J Sports Med 2020;11:51-75. PMID 32158285. doi:10.2147/OAJSM.S231405
- Griffin A et al. Sports Med 2020;50:561-80. PMID 31691167. doi:10.1007/s40279-019-01218-2
- Tanda G, Knechtle B. Open Access J Sports Med 2013;4:141-9. PMID 24379719. doi:10.2147/OAJSM.S44945
- Tanda G, Knechtle B. Open Access J Sports Med 2015;6:129-36. PMID 25995653. doi:10.2147/OAJSM.S80637
- Campos Y et al. Int J Sports Med 2022;43:305-16. PMID 34749417. doi:10.1055/a-1559-3623
- Ely MR et al. Med Sci Sports Exerc 2007;39:487-93. PMID 17473775. doi:10.1249/mss.0b013e31802d3aba
- Thomas DT, Erdman KA, Burke LM. Med Sci Sports Exerc 2016;48:543-68. PMID 26891166. doi:10.1249/MSS.0000000000000852
- Malisoux L et al. Scand J Med Sci Sports 2015 (Consensus) — parallel shoe use HR 0.614
- Burke A et al. Sports Med Open 2023 (Consensus) — prior injury, marathon training as risk factors
- Manresa-Rocamora A et al. IJERPH 2021; Düking P et al. J Sci Med Sport 2021 (Consensus) — HRV-guided training meta-analyses
- Doherty C et al. Transl Exerc Biomed 2025 (Consensus) — composite wearable scores lack transparency/validation
