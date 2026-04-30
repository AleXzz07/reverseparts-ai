# Evaluation Tool

Standalone evaluator for scoring REVERSEPARTS CAD extraction output against ground truth.

It is not connected to the Next.js app.

## Goal

Compare:

1. JSON produced by `tools/cad_feature_extractor`
2. `dataset_examples/pezzo_001_staffa_test/expected_output.json` or PDF-derived ground truth

The report is emitted as JSON and includes:

- correct fields;
- missing fields;
- different fields;
- percentage error for dimensions, weight, thickness and blank data;
- hole/flange recognition precision;
- CAD extraction accuracy score from `0` to `100`.

## Usage

```bash
python tools/evaluation/evaluate.py \
  tools/cad_feature_extractor/sample_output.json \
  dataset_examples/pezzo_001_staffa_test/expected_output.json \
  --pretty
```

Write the report to a file:

```bash
python tools/evaluation/evaluate.py cad_output.json expected_output.json \
  --pretty \
  --output report.json
```

## Scoring

The final score combines:

- field correctness: `40%`;
- numeric accuracy: `35%`;
- feature recognition F1 score: `25%`.

Missing values remain missing; the evaluator does not infer technical data.
PDF extractor output can be used to prepare ground truth, but it is not the primary extraction target.
