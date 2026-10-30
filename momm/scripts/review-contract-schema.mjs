// One generation schema for the existing peer contract. A grammar is not a vote.
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
export const REVIEW_JSON_SCHEMA = freeze({
  type: 'object', additionalProperties: false,
  required: ['review_status', 'reviewed_scope', 'verdict', 'confidence', 'findings', 'summary', 'suggested_improvements'],
  properties: {
    review_status: {type: 'string', enum: ['complete', 'incomplete']},
    reviewed_scope: {type: 'array', maxItems: 12, items: {anyOf: [
      {type: 'object', additionalProperties: false, required: ['quote', 'assessment'], properties: {quote: {type: 'string', maxLength: 500}, assessment: {type: 'string', maxLength: 1000}}},
      {type: 'object', additionalProperties: false, required: ['attachment_sha256', 'observation', 'assessment'], properties: {attachment_sha256: {type: 'string', maxLength: 64}, observation: {type: 'string', maxLength: 500}, assessment: {type: 'string', maxLength: 1000}, region: {type: 'array', items: {type: 'integer', minimum: 0}, minItems: 4, maxItems: 4}}}
    ]}},
    verdict: {type: 'string', enum: ['ACCEPT', 'MODIFY', 'REJECT']},
    suggested_improvements: {type: 'array', maxItems: 20, items: {type: 'string', maxLength: 500}},
    confidence: {type: 'number', minimum: 0, maximum: 1},
    findings: {type: 'array', maxItems: 50, items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'severity', 'target_file', 'line_range', 'issue', 'rationale', 'test_suggestion'],
      properties: {
        id: {type: 'string', maxLength: 80},
        severity: {type: 'string', enum: ['CRITICAL', 'WARNING', 'NITPICK']},
        target_file: {type: ['string', 'null'], maxLength: 500},
        line_range: {anyOf: [{type: 'array', prefixItems: [{type: 'integer'}, {type: 'integer'}], minItems: 2, maxItems: 2}, {type: 'null'}]},
        issue: {type: 'string', maxLength: 2000}, rationale: {type: 'string', maxLength: 2000},
        test_suggestion: {type: ['string', 'null'], maxLength: 1500},
        region: {type: 'array', items: {type: 'integer', minimum: 0}, minItems: 4, maxItems: 4},
        claim_type: {type: 'string', enum: ['DEFECT', 'RISK', 'QUESTION', 'IDEA', 'NOISE']}
      }
    }},
    summary: {type: 'string', maxLength: 1000}
  }
});
