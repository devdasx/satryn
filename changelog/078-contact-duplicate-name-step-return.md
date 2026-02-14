# 078 — Contact Duplicate Name: Return to Step 1

## Overview
When saving a contact with a duplicate name, the error alert now returns the user to Step 1 (name & addresses) so they can change the name immediately.

## Problem
Previously, the duplicate name error showed an Alert but left the user on the Review step (Step 3). They had to manually navigate back to change the name.

## Fix
Added `setStep(1)` in the catch block of `handleSave` after the duplicate name Alert, so the user is automatically taken back to the name input step.

## Files Changed
| File | Changes |
|------|---------|
| `src/components/contacts/AddEditContactSheet.tsx` | Added `setStep(1)` after duplicate name error Alert |
