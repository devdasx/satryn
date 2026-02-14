# 076 — Currency Symbol Standardization: Respect User's Local Currency

## Overview
Fixed hardcoded "$" and limited currency symbol mappings across 6 files. All currency displays now use `PriceAPI.formatPrice()` or `PriceAPI.getCurrencySymbol()` which supports 28+ currencies (USD, EUR, GBP, JPY, JOD, AED, SAR, INR, etc.).

## Problem
Multiple components hardcoded `$` for fiat display or had limited ternary chains (USD/EUR/GBP/JPY only). Users who selected currencies like JOD, AED, INR, or SAR would see incorrect symbols or no symbol at all.

## Fixes

| File | Line(s) | Before | After |
|------|---------|--------|-------|
| `app/(auth)/receive.tsx` | formatFiat | `if (currency === 'USD') return '$...'` | `PriceAPI.formatPrice(val, currency)` |
| `app/(auth)/receive.tsx` | amount badge | `currency === 'USD' ? '$' : ''` | `PriceAPI.formatPrice(fiatValue, currency)` |
| `app/(auth)/receive.tsx` | amount preview | `≈ $${fiatValue.toFixed(2)}` | `PriceAPI.formatPrice(fiatValue, currency)` |
| `app/(auth)/sign-transaction.tsx` | formatFiat | `$${fiat.toFixed(2)}` | `PriceAPI.formatPrice(fiat, currency)` |
| `src/components/send-v2/components/AmountDisplay.tsx` | hero prefix | `'$'` | `PriceAPI.getCurrencySymbol(currency)` |
| `src/components/send-v3/steps/StepAmount.tsx` | heroPrefix | `currency === 'USD' ? '$' : currency === 'EUR' ? ...` | `PriceAPI.getCurrencySymbol(currency)` |
| `src/components/send-v3/steps/StepAmount.tsx` | conversionText | `${fiatVal.toFixed(2)} ${currency}` | `PriceAPI.formatPrice(fiatVal, currency)` |
| `src/components/payment/PaymentSheet.tsx` | fiatPrefix | `currency === 'USD' ? '$' : currency === 'EUR' ? ...` | `PriceAPI.getCurrencySymbol(currency)` |
| `src/components/payment/PaymentSheet.tsx` | conversionText | `${fiatVal.toFixed(2)} ${currency}` | `PriceAPI.formatPrice(fiatVal, currency)` |
| `src/components/contacts/RequestFromContactSheet.tsx` | preview (2x) | `currency === 'USD' ? '$' : ''...` | `PriceAPI.formatPrice(fiatValue, currency)` |

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/receive.tsx` | 3 currency fixes + PriceAPI import |
| `app/(auth)/sign-transaction.tsx` | formatFiat fix + PriceAPI import |
| `src/components/send-v2/components/AmountDisplay.tsx` | Hero prefix fix |
| `src/components/send-v3/steps/StepAmount.tsx` | Hero prefix + conversion text + PriceAPI import |
| `src/components/payment/PaymentSheet.tsx` | Fiat prefix + conversion text + PriceAPI import |
| `src/components/contacts/RequestFromContactSheet.tsx` | 2 currency fixes + PriceAPI import |

## TypeScript
Compiles with 0 errors.
