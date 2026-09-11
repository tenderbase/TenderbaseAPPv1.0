import { strict as assert } from "node:assert";
import { parseEThekwiniPage } from "../src/sources/ethekwini.js";

const fixture = `
<section><div>Tender</div>
<h3>TRAVEL ARRANGEMENTS SERVICES FOR 12 MONTHS PERIOD.</h3>
<div>General · RFQ</div>
<div>Reference LD 882</div>
<div>Closing 09/18/2026 11:00</div>
<div>Summary</div><p>TRAVEL ARRANGEMENTS SERVICES FOR 12 MONTHS PERIOD.</p>
<div>Procuring Entity UShaka Marine World</div>
<div>Contact Person Londeka Didi</div>
<div>Contact Number 031 328 8032</div>
<div>Email ldidi@ushakamarineworld.co.za</div>
<div>Documents</div><a href="/uploads/ld-882.pdf">Main Tender Document: ld-882.pdf</a>
</section>
<section><div>Tender</div>
<h3>Supply And Delivery of Fresh Meats for One Month</h3>
<div>General · RFQ</div>
<div>Reference TN 001</div>
<div>Closing 09/16/2026 11:00</div>
<div>Summary</div><p>Supply And Delivery of Fresh Meats for One Month.</p>
<div>Procuring Entity UShaka Marine World</div>
<div>Contact Person Warren Frantz</div>
<div>Contact Number 031 328 8068</div>
<div>Email wfrantz@ushakamarineworld.co.za</div>
<a href="/uploads/tn-001.pdf">Main Tender Document: tn-001.pdf</a>
</section>`;

const tenders = parseEThekwiniPage(fixture);
assert.equal(tenders.length, 2);
assert.equal(tenders[0]?.tenderNumber, "LD 882");
assert.equal(tenders[0]?.organisation, "UShaka Marine World");
assert.equal(tenders[0]?.province, "KwaZulu-Natal");
assert.equal(tenders[0]?.documents.length, 1);
assert.match(tenders[0]?.documents[0]?.url ?? "", /ld-882\.pdf$/);
assert.equal(tenders[1]?.tenderNumber, "TN 001");
assert.equal(tenders[1]?.documents.length, 1);
console.log("eThekwini parser test passed");
