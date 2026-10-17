# Synthetic delivery documents

- `SHP-001_manifest.pdf`: text-extractable manifest for 600 kg (60 x 10 kg) inert fictional vaccine training cargo, TN-07 / DRV-007, Hosur to fictional Chennai receiver, due 09:00 IST, declared simulated value INR 1,200,000.
- `SHP-001_delivery_slip.pdf`: deliberately **unreceived and unsigned** delivery form for the same shipment. Arrival, receiving temperature, quantity received, contents condition, and recipient confirmation are not recorded.

Every page is marked **SYNTHETIC TRAINING ONLY**. JSON sidecars provide structured fields, SHA-256, missing-field expectations, and unsupported inferences. PDFs were generated with ReportLab from original fixture text; original fixture content is CC0-1.0.

Fixed replay: 2026-10-17 02:00 +05:30. The scenario projects a 03:00 cold-control deadline separately from the 09:00 delivery completion deadline. Neither is a real vaccine expiry/viability determination. Documents are not booking confirmations, signed delivery evidence, real commercial documents, or medical guidance. Notification addresses use the non-deliverable `.invalid` domain.
