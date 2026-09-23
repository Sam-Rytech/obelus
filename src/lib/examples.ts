/**
 * One-click examples on the home page — architecture §15.
 *
 * Examples A (a real, clean announcement) and B (a real, mixed one) were picked on Day 5
 * from 22 real announcements run through the live site (fixtures/real/results*.json).
 * Each carries a `reportId` so the page loads instantly.
 *
 * Example C is synthetic and MUST stay labelled as such (§15): it is about a real Base
 * token but was written by the Obelus team to show all three verdicts at once, and must
 * never be presented as that project's statement.
 */
export type Example = {
  id: string;
  label: string;
  /** Shown beside the button. For a test example, it must say it is a test. */
  note: string;
  input: string;
  synthetic: boolean;
  /** A pre-run report to open instead of running live (§15: demos load instantly). */
  reportId?: string;
};

const TEST_ANNOUNCEMENT = `TEST ANNOUNCEMENT — written by the Obelus team for testing. Not a real statement by any project.

Aerodrome Finance (AERO) — Ecosystem Update

AERO is now listed on WEEX and BingX. The token contract is
0x940181a94A35A4569E4529A3CDfB74e38FD98631 on Base.

Our protocol has been audited by CertiK, and ownership of the token contract has been
renounced. Liquidity is locked for 24 months with UNCX.

We are also proud to announce our partnership with Chainlink. Total value locked has
now crossed $370,000,000.

AERO will be listed on Binance next month.`;

export const EXAMPLES: Example[] = [
  {
    id: "a",
    label: "A real audit announcement",
    note: "Trusted Smart Chain's press release, checked against CertiK's own page.",
    input: "https://chainwire.org/2026/01/18/trusted-smart-chain-completes-certik-audit-advancing-secure-rwa-tokenization/",
    synthetic: false,
    reportId: "5zvwvrM6FR",
  },
  {
    id: "b",
    label: "A real token launch",
    note: "Aligned's launch press release: one claim confirmed, the rest can't be yet.",
    input: "https://chainwire.org/2026/08/21/aligned-launches-align-the-native-token-of-its-full-ethereum-stack/",
    synthetic: false,
    reportId: "f0uh4Plxvf",
  },
  {
    id: "test",
    label: "Try a test announcement",
    note: "Written by the Obelus team about a real Base token, mixing true and false claims.",
    input: TEST_ANNOUNCEMENT,
    synthetic: true,
    reportId: "srezxyJ1aX",
  },
];
