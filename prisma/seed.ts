import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds five datasets across five languages, each with contributors, at least
 * one licence, and a royalty payout.
 *
 * Written to be idempotent: every write is an upsert keyed on the id the
 * contract would assign, so running it twice leaves the same five rows rather
 * than ten. That matters because CI seeds before every test run.
 */

const DATASETS = [
  {
    id: "ds-yor-001",
    ownerId: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    languageCode: "yor",
    name: "Yorùbá conversational corpus",
    metadataIpfs: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    createdLedger: 51_200_100,
    contributors: [
      { address: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", shareBps: 6000 },
      { address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", shareBps: 4000 },
    ],
    licenses: [
      { id: "lic-yor-001", licensee: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ", licenseType: "commercial", feePaidStroops: 2_500_000_000n, expiryLedger: 52_000_000, regionCode: "NG" },
      { id: "lic-yor-002", licensee: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37", licenseType: "research", feePaidStroops: 0n, expiryLedger: null, regionCode: null },
    ],
    payouts: [{ totalAmount: 1_500_000_000n, ledger: 51_900_000 }],
  },
  {
    id: "ds-swa-001",
    ownerId: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    languageCode: "swa",
    name: "Swahili broadcast transcripts",
    metadataIpfs: "bafybeih5m4rfqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqz",
    createdLedger: 51_210_400,
    contributors: [
      { address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", shareBps: 10_000 },
    ],
    licenses: [
      { id: "lic-swa-001", licensee: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ", licenseType: "commercial", feePaidStroops: 4_000_000_000n, expiryLedger: 52_500_000, regionCode: "KE" },
    ],
    payouts: [{ totalAmount: 4_000_000_000n, ledger: 51_950_000 }],
  },
  {
    id: "ds-hau-001",
    ownerId: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ",
    languageCode: "hau",
    name: "Hausa read speech",
    metadataIpfs: null,
    createdLedger: 51_220_900,
    contributors: [
      { address: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ", shareBps: 7500 },
      { address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37", shareBps: 2500 },
    ],
    licenses: [
      { id: "lic-hau-001", licensee: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", licenseType: "evaluation", feePaidStroops: 100_000_000n, expiryLedger: 51_400_000, regionCode: "NG" },
    ],
    payouts: [],
  },
  {
    id: "ds-amh-001",
    ownerId: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    languageCode: "amh",
    name: "Amharic legal documents",
    metadataIpfs: "bafybeic3ld4wq7jvcnmbnh6cqvvv2ejpwqfjq5xbjqfbjqfbjqfbjqfbjq",
    createdLedger: 51_231_700,
    // A dataset whose state is not "active" — the listing endpoint filters on
    // state, so the seed needs at least one row that must not appear by
    // default.
    state: "archived",
    contributors: [
      { address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37", shareBps: 10_000 },
    ],
    licenses: [],
    payouts: [],
  },
  {
    id: "ds-zul-001",
    ownerId: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    languageCode: "zul",
    name: "isiZulu parallel translation pairs",
    metadataIpfs: "bafybeidkm2rj3jvcnmbnh6cqvvv2ejpwqfjq5xbjqfbjqfbjqfbjqfbjq2",
    createdLedger: 51_240_300,
    version: 2,
    contributors: [
      { address: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", shareBps: 5000 },
      { address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", shareBps: 3000 },
      { address: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ", shareBps: 2000 },
    ],
    licenses: [
      { id: "lic-zul-001", licensee: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37", licenseType: "commercial", feePaidStroops: 7_250_000_000n, expiryLedger: 53_000_000, regionCode: "ZA" },
      { id: "lic-zul-002", licensee: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", licenseType: "research", feePaidStroops: 0n, expiryLedger: null, regionCode: "ZA" },
    ],
    payouts: [
      { totalAmount: 3_000_000_000n, ledger: 51_800_000 },
      { totalAmount: 4_250_000_000n, ledger: 51_990_000 },
    ],
  },
];

async function main() {
  for (const d of DATASETS) {
    const { contributors, licenses, payouts, ...dataset } = d;

    await prisma.dataset.upsert({
      where: { id: dataset.id },
      update: dataset,
      create: dataset,
    });

    for (const c of contributors) {
      await prisma.contributor.upsert({
        where: { datasetId_address: { datasetId: dataset.id, address: c.address } },
        update: { shareBps: c.shareBps },
        create: { datasetId: dataset.id, ...c },
      });
    }

    for (const l of licenses) {
      await prisma.license.upsert({
        where: { id: l.id },
        update: { ...l, datasetId: dataset.id },
        create: { ...l, datasetId: dataset.id },
      });
    }

    // Payouts have generated ids and no natural key, so they are replaced
    // wholesale rather than upserted — otherwise reseeding accumulates them.
    await prisma.royaltyPayout.deleteMany({ where: { datasetId: dataset.id } });
    for (const p of payouts) {
      await prisma.royaltyPayout.create({ data: { datasetId: dataset.id, ...p } });
    }
  }

  const counts = {
    datasets: await prisma.dataset.count(),
    contributors: await prisma.contributor.count(),
    licenses: await prisma.license.count(),
    royaltyPayouts: await prisma.royaltyPayout.count(),
  };
  console.log("seeded:", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
