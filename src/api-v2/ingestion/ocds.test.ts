import assert from "node:assert/strict";
import test from "node:test";
import { classifyProcurementType, normalizeRelease } from "./ocds.js";

test("normalizes an OCDS release into TenderBase fields and documents", () => {
  const result = normalizeRelease({
    ocid: "ocds-abc-123", id: "release-1", date: "2026-09-12T08:00:00Z",
    buyer: { name: "Example Municipality" },
    tender: {
      id: "TN-123", title: "Supply of cleaning materials", description: "Request for quotation for cleaning materials",
      category: "Goods", province: "KwaZulu-Natal", deliveryLocation: "Durban",
      value: { amount: 125000, currency: "ZAR" }, tenderPeriod: { end: "2026-09-30T12:00:00Z" },
      contactPerson: { name: "Procurement Officer", email: "procurement@example.org", telephone: "0310000000" },
      procurementMethod: "open", procurementMethodDetails: "Request for Quotation", status: "active",
      documents: [
        { title: "RFQ document.pdf", url: "https://example.org/rfq.pdf", format: "application/pdf" },
        { title: "Addendum 1", url: "https://example.org/addendum.pdf" },
      ],
    },
  }, "https://ocds-api.etenders.gov.za/api/OCDSReleases");

  assert.equal(result.ocid, "ocds-abc-123");
  assert.equal(result.releaseId, "release-1");
  assert.equal(result.tenderNumber, "TN-123");
  assert.equal(result.organisation, "Example Municipality");
  assert.equal(result.category, "Goods");
  assert.equal(result.province, "KwaZulu-Natal");
  assert.equal(result.location, "Durban");
  assert.equal(result.valueCents, 12500000n);
  assert.equal(result.procurementType, "RFQ");
  assert.equal(result.contactEmail, "procurement@example.org");
  assert.equal(result.raw._tenderbaseCurrency, "ZAR");
  assert.equal(result.documents.length, 2);
  assert.equal(result.documents[0]?.fileType, "application/pdf");
  assert.equal(result.documents[1]?.isAddendum, true);
});

test("classifies common South African procurement labels", () => {
  assert.equal(classifyProcurementType({ title: "Request for Quotation" }, {}), "RFQ");
  assert.equal(classifyProcurementType({ title: "Request for Information" }, {}), "RFI");
  assert.equal(classifyProcurementType({ title: "Request for Proposal" }, {}), "RFP");
  assert.equal(classifyProcurementType({ title: "Expression of Interest" }, {}), "EOI");
  assert.equal(classifyProcurementType({ title: "Tender Addendum" }, {}), "ADDENDUM");
  assert.equal(classifyProcurementType({ title: "Tender Cancellation" }, {}), "CANCELLATION");
});

test("rejects releases without stable OCDS identity", () => {
  assert.throws(() => normalizeRelease({ tender: { title: "Missing identity" } }, "https://example.org"), /ocid or id/);
});
