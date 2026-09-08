import webpush from "web-push";
import { prisma } from "../db/prisma.js";
import type { Tender } from "@prisma/client";

export interface NotifPayload {
  title: string;
  body: string;
  tag: string;
  data: Record<string, unknown>;
}

/**
 * 92.9% of tender titles are bare reference codes ("0010572182",
 * "RFX 60000003542"). An alert reading "New tender: RFX 60000003542" is
 * useless, so the DESCRIPTION always leads the message.
 */
export function buildPayload(tender: Tender, type: string): NotifPayload {
  const summary = (tender.description ?? tender.title ?? "New tender").slice(0, 140);
  const closing = tender.closingDate
    ? new Date(tender.closingDate).toISOString().slice(0, 16).replace("T", " ")
    : null;

  if (type === "expiring") {
    return {
      title: "Tender closing soon",
      body: `${summary} — closes ${closing ?? "soon"}`,
      tag: `expiring-${tender.id}`,
      data: { tenderId: tender.id, type, closingDate: tender.closingDate },
    };
  }
  return {
    title: "New tender match",
    body: summary,
    tag: `new-${tender.id}`,
    data: { tenderId: tender.id, type, closingDate: tender.closingDate },
  };
}

/**
 * Web Push (VAPID). Returns false when unconfigured so the caller records
 * nothing rather than a false "sent".
 *
 * iOS caveat: the PWA must be added to the home screen before push works.
 */
async function sendPush(userId: string, payload: NotifPayload): Promise<boolean> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:ops@tenderbase.example",
    publicKey,
    privateKey
  );

  let delivered = false;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "normal" }
      );
      delivered = true;
    } catch (err: any) {
      // 404/410 = subscription expired or unsubscribed — drop it.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  }
  return delivered;
}

/** Email via Resend. Returns false when unconfigured. */
async function sendEmail(
  to: string | null,
  payload: NotifPayload
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "TenderBase <alerts@tenderbase.example>",
        to: [to],
        subject: payload.title,
        text: `${payload.body}\n\nhttps://tenderbase-web.onrender.com`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Deliver pending notifications. The Notification row IS the in-app
 * notification, so in-app delivery just stamps inappSentAt.
 */
export async function dispatchPending(limit = 200) {
  const pending = await prisma.notification.findMany({
    where: { inappSentAt: null },
    include: { tender: true, filterSet: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let inapp = 0;
  let push = 0;
  let email = 0;

  for (const n of pending) {
    const payload = buildPayload(n.tender, n.type);
    const now = new Date();
    const update: Record<string, Date> = { inappSentAt: now };
    inapp++;

    const channels = n.filterSet.channels ?? [];
    if (channels.includes("push") && (await sendPush(n.userId, payload))) {
      update.pushSentAt = now;
      push++;
    }
    if (
      channels.includes("email") &&
      (await sendEmail(n.filterSet.notifyEmail, payload))
    ) {
      update.emailSentAt = now;
      email++;
    }

    await prisma.notification.update({ where: { id: n.id }, data: update });
  }

  return { processed: pending.length, inapp, push, email };
}
