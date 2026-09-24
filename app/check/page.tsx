import type { Metadata } from "next";

import { EXAMPLES } from "@/src/lib/examples";

import { Checker } from "../_components/Checker";

export const metadata: Metadata = {
  title: "Check an announcement",
  description: "Paste an X post, a press-release link or the text itself. Obelus checks each claim at its source.",
};

const INPUTS = [
  { what: "An X post", example: "https://x.com/project/status/1234…" },
  { what: "A web page", example: "A press release, a news story, a project site" },
  { what: "The text itself", example: "Paste the announcement as it was posted" },
  { what: "A listing question", example: "Is $PEPE listed on MEXC?" },
];

export default function CheckPage() {
  return (
    <div className="wrap narrow check-page">
      <h1 className="page-title">Check an announcement</h1>
      <p className="page-sub">A check takes about five seconds. Each claim comes back marked, with a link to its proof.</p>
      <Checker variant="page" examples={EXAMPLES} autoFocus />
      <dl className="inputs">
        {INPUTS.map((i) => (
          <div key={i.what}>
            <dt>{i.what}</dt>
            <dd>{i.example}</dd>
          </div>
        ))}
      </dl>
      <p className="fine-print">Up to 10 checks an hour from one connection. Every report gets a public link.</p>
    </div>
  );
}
