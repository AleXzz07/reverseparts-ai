# Evaluation Tool

Standalone evaluator for comparing REVERSEPARTS extractor output against dataset ground truth.

It is not connected to the Next.js app.

## Goal

Compare:

1. `dataset_examples/pezzo_001_staffa_test/expected_output.json`
2. JSON produced by `tools/pdf_extractor` or `tools/cad_feature_extractor`

The report is emitted as JSON and includes:

- correct fields;
- missing fields;
- different fields;
- percentage error for dimensions, weight, thickness and blank data;
- hole/flange recognition precision;
- final score from `0` to `100`.

## Usage

```bash
python tools/evaluation/evaluate.py \
  dataset_examples/pezzo_001_staffa_test/expected_output.json \
  tools/pdf_extractor/sample_output.json \
  --pretty
```

Write the report to a file:

```bash
python tools/evaluation/evaluate.py expected_output.json extracted_output.json \
  --pretty \
  --output report.json
```

## Scoring

The final score combines:

- field correctness: `40%`;
- numeric accuracy: `35%`;
- feature recognition F1 score: `25%`.

Missing values remain missing; the evaluator does not infer technical data.
