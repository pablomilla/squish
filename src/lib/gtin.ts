/**
 * The number under a barcode.
 *
 * Formally a GTIN: eight digits on a small packet, thirteen on most European
 * groceries, twelve on American ones, fourteen on a case. Kept apart from the
 * scanner itself so the server can apply exactly the same rule to what the
 * camera sends it — two definitions of "is this a barcode" would eventually
 * disagree.
 */
export function looksLikeBarcode(value: string): boolean {
  return /^\d{8,14}$/.test(value);
}
