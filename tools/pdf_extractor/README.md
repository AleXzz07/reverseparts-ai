# PDF Extractor

Standalone Python support tool for extracting declared technical data from PDF quote or analysis documents, including examples such as `STAFFA TEST 1-1`.

PDF is not the primary technical source for REVERSEPARTS. STP/STEP CAD extraction is the primary path; PDF output is used as ground truth or validation data when comparing CAD extraction accuracy.

The extractor is conservative by design:

- missing values remain `null` or empty arrays;
- no technical data is inferred when it is not present in the PDF text;
- warnings are emitted when PDF text extraction is poor or expected fields are missing;
- the module is not connected to the application.

## Install

```bash
pip install -r requirements.txt
```

## Usage

```bash
python extractor.py path/to/technical-file.pdf --pretty
```

## Output Fields

- `part_name`
- `material`
- `thickness_mm`
- `dimensions_mm`
- `part_weight_kg`
- `blank_size_mm`
- `blank_weight_kg`
- `blank_perimeter_mm`
- `features.circular_holes`
- `features.elongated_holes`
- `features.polygonal_holes`
- `features.flanges`
- `process_steps`
- `warnings`

## Notes

This tool reads extractable PDF text with `pdfplumber`. Scanned PDFs or low-quality exports may require OCR before extraction.
