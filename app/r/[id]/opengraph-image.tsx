/**
 * The card X and Telegram show when a report link is shared: the project, the tally, and
 * the claim that matters most. Plain system fonts — next/og's default — to stay fast.
 */
import { ImageResponse } from "next/og";

import { getReport } from "@/src/lib/store";
import { tally } from "@/src/lib/summary";

import { buildEntries, headline, isTestAnnouncement, projectTitle } from "../../_components/report-model";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "An Obelus report: each claim checked against its source";

const INK = "#1a2230";
const INK_2 = "#5b6472";
const COLOR = { VERIFIED: "#1f7a5a", CONTRADICTED: "#c23b2a", UNVERIFIED: "#a87b12", NOT_CHECKABLE: "#8a919c" };
const SIGN = { VERIFIED: "※", CONTRADICTED: "÷", UNVERIFIED: "?", NOT_CHECKABLE: "–" };

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id).catch(() => null);

  const title = report ? projectTitle(report) : "Obelus report";
  const t = report ? tally(report.results) : null;
  const lead = report ? headline(buildEntries(report).filter((e) => e.category !== "NOT_CHECKABLE")) : undefined;
  const quote = lead ? (lead.quote.length > 120 ? `${lead.quote.slice(0, 119)}…` : lead.quote) : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#f3f4f0",
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
          <span style={{ color: COLOR.CONTRADICTED }}>÷</span> Obelus
          {report && isTestAnnouncement(report) && (
            <span style={{ marginLeft: 16, fontSize: 22, fontWeight: 400, color: INK_2 }}>Test announcement</span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1 }}>{title}</div>
          {lead && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, fontSize: 30, color: INK_2 }}>
              <span style={{ color: COLOR[lead.category], fontWeight: 700 }}>{SIGN[lead.category]}</span>
              <span style={{ display: "flex" }}>{quote}</span>
            </div>
          )}
        </div>

        {t && (
          <div style={{ display: "flex", gap: 44, fontSize: 32, fontWeight: 600 }}>
            <span style={{ color: COLOR.VERIFIED }}>※ {t.verified} verified</span>
            <span style={{ color: COLOR.CONTRADICTED }}>÷ {t.contradicted} contradicted</span>
            <span style={{ color: COLOR.UNVERIFIED }}>? {t.unverified} unverified</span>
          </div>
        )}
      </div>
    ),
    size,
  );
}
