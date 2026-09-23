"use client";

/**
 * Verify a report — architecture §11. Everything here runs in the visitor's browser:
 *
 *   1. Re-hash the report JSON with the same canonicalization the server used.
 *   2. Read the attestation straight from EAS on Base (public RPC, no Obelus server).
 *   3. Compare the on-chain hash to the re-computed one.
 *
 * If the report were edited after it was attested — one verdict changed — step 3 fails.
 * The only thing taken from Obelus is the report itself, which is what is being tested.
 */
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { createPublicClient, http, type Hex } from "viem";
import { base } from "viem/chains";

import { decodeReceipt, EAS_ABI, EAS_ADDRESS, schemaUid } from "@/src/lib/eas";
import { reportHash } from "@/src/lib/hash";
import type { Report } from "@/src/lib/schema";

import { Sign } from "../../../_components/Sign";

type Check = { state: "pass" | "fail" | "pending" | "running"; title: string; detail: React.ReactNode };

const VERDICT = { pass: "VERIFIED", fail: "CONTRADICTED", pending: "UNVERIFIED", running: "UNVERIFIED" } as const;

export default function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [checks, setChecks] = useState<Check[]>([
    { state: "running", title: "Fetching the report", detail: "…" },
  ]);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch(`/api/report/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "No report with that id." : `Could not load the report (HTTP ${res.status}).`);
      const report = (await res.json()) as Report;

      // 1. Re-hash locally.
      const local = reportHash(report as unknown as Record<string, unknown>);
      const hashMatches = local === report.reportHash;
      const out: Check[] = [
        {
          state: hashMatches ? "pass" : "fail",
          title: hashMatches ? "The report matches its own fingerprint" : "The report does not match its fingerprint",
          detail: (
            <>
              Recomputed in your browser: <span className="data">{local}</span>
              <br />
              Stated in the report: <span className="data">{report.reportHash}</span>
            </>
          ),
        },
      ];

      // 2 + 3. Read the receipt from Base and compare.
      if (!report.attestation) {
        out.push({
          state: "pending",
          title: "No receipt on Base yet",
          detail: "This report hasn't been attested on-chain yet, so there is nothing to compare against. Check back shortly.",
        });
      } else {
        const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
        const att = await client.readContract({
          address: EAS_ADDRESS,
          abi: EAS_ABI,
          functionName: "getAttestation",
          args: [report.attestation.uid as Hex],
        });

        const expectedSchema = schemaUid();
        const rightSchema = att.schema.toLowerCase() === expectedSchema.toLowerCase();
        const onChain = rightSchema ? decodeReceipt(att.data) : null;
        const chainMatches = onChain?.reportHash.toLowerCase() === local.toLowerCase();

        out.push({
          state: rightSchema ? "pass" : "fail",
          title: rightSchema ? "A receipt exists on Base" : "The attestation isn't an Obelus receipt",
          detail: (
            <>
              Read from the EAS contract on Base, not from Obelus.{" "}
              <a href={`https://base.easscan.org/attestation/view/${report.attestation.uid}`} target="_blank" rel="noreferrer">
                View it on EASScan
              </a>
              . Recorded {new Date(Number(att.time) * 1000).toUTCString()} by{" "}
              <span className="data">{att.attester}</span>.
            </>
          ),
        });
        out.push({
          state: chainMatches ? "pass" : "fail",
          title: chainMatches
            ? "The on-chain fingerprint matches — this report hasn't been edited since it was recorded"
            : "The on-chain fingerprint does NOT match — this report changed after it was recorded",
          detail: (
            <>
              On Base: <span className="data">{onChain?.reportHash ?? "unreadable"}</span>
              {onChain && (
                <>
                  <br />
                  Counts on Base: {onChain.verified} verified, {onChain.contradicted} contradicted, {onChain.unverified}{" "}
                  unverified.
                </>
              )}
            </>
          ),
        });
      }

      if (!cancelled) setChecks(out);
    })().catch((err: unknown) => {
      if (!cancelled) setFatal(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <article>
      <h1 className="title">Verify this report</h1>
      <p className="lede">
        Every Obelus report gets a fingerprint — a keccak256 hash of its contents — recorded on Base. This page
        recomputes the fingerprint in your browser and reads the record straight from the chain. If anyone had
        changed a single verdict, they would no longer match.
      </p>

      {fatal ? (
        <p className="error" role="alert">
          {fatal}
        </p>
      ) : (
        <ol className="claims" aria-live="polite">
          {checks.map((c) => (
            <li key={c.title} className="margined">
              <div className="sign" data-verdict={VERDICT[c.state]}>
                <Sign verdict={VERDICT[c.state]} />
              </div>
              <div>
                <p className="check-title">{c.title}</p>
                <p className="claim-reason meta">{c.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="actions">
        <Link href={`/r/${id}`} className="button">
          Back to the report
        </Link>
      </p>
    </article>
  );
}
