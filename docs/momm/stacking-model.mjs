// Teaching model only. These parameters are NOT fitted to MOMM telemetry.
export function stackingModel({ reviewers = 4, detection = 0.5, blindSpot = 0.1 } = {}) {
  if (!Number.isInteger(reviewers) || reviewers < 1 || reviewers > 10) throw new RangeError('Choose 1–10 hypothetical reviewers');
  for (const value of [detection, blindSpot]) if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Probabilities must be between zero and one');
  // A shared subset b is missed by everyone. Outside it, each reviewer detects
  // a defect with probability p, independently of the others.
  const miss = blindSpot + (1 - blindSpot) * (1 - detection) ** reviewers;
  const singleMiss = blindSpot + (1 - blindSpot) * (1 - detection);
  return { miss, caught: 1 - miss, singleMiss, missReduction: miss === 0 ? null : singleMiss / miss };
}

export function bindStackingModel(document) {
  const form = document.getElementById('stacking-controls');
  if (!form) return;
  const output = document.getElementById('stacking-result');
  const update = () => {
    try {
      if (![form.elements.reviewers, form.elements.detection, form.elements.blindSpot].every(el => String(el.value).trim() !== '')) throw new RangeError('Missing assumption');
      const reviewers = Number(form.elements.reviewers.value);
      const detection = Number(form.elements.detection.value) / 100;
      const blindSpot = Number(form.elements.blindSpot.value) / 100;
      const r = stackingModel({reviewers, detection, blindSpot});
      output.textContent = `Hypothetical result: ${(r.miss * 100).toFixed(2)}% of defects missed by all ${reviewers} reviewers, versus ${(r.singleMiss * 100).toFixed(2)}% with one. ${r.missReduction === null ? 'A relative reduction is undefined when the model gives zero misses.' : r.missReduction.toFixed(2) + '× lower all-miss probability.'} This is not a MOMM benchmark, a productivity multiplier or a supported pool-size promise. False positives and verification errors are not modelled.`;
    } catch { output.textContent = 'Enter 1–10 reviewers and probabilities from 0 to 100. No prediction can be made from invalid assumptions.'; }
  };
  form.addEventListener('input', update);
  form.addEventListener('submit', event => event.preventDefault());
  update();
}
if (typeof document !== 'undefined') bindStackingModel(document);
