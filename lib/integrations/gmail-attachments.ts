import type { gmail_v1 } from 'googleapis';

// Shared Gmail attachment extraction used by every sync path (sync-all,
// per-account sync and the legacy check-inbox route). Previously only
// sync-all extracted attachments — and only inline images ≤2MB — which is
// why customers' photos (routinely >2MB) and PDFs never showed up in the
// app and support had to open Gmail to see them.

// A single attachment ready to be stored on a ticket's contextData. The
// data URL lets the UI render images inline and offer non-images as a
// download without another round-trip to Gmail.
export interface StoredAttachment {
  filename: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

interface AttachmentMeta {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

// Per-attachment size cap. Phone photos are commonly 3–8MB, so the old
// 2MB limit silently dropped most of them. 10MB covers typical photos and
// scanned PDFs while still bounding how much we persist per ticket.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// How many attachments to keep per message. Generous enough for a batch
// of photos without letting a pathological mail balloon a ticket row.
export const MAX_ATTACHMENTS = 12;

// Walk the (possibly deeply nested) MIME tree and collect every part that
// is a real attachment — i.e. has an attachmentId and a filename. Unlike
// the previous implementation this is NOT limited to image/* so PDFs and
// other documents the customer attaches are captured too.
export function extractAttachmentMeta(
  parts: gmail_v1.Schema$MessagePart[] | undefined,
): AttachmentMeta[] {
  if (!parts) return [];
  const found: AttachmentMeta[] = [];
  for (const part of parts) {
    const attachmentId = part.body?.attachmentId;
    const filename = part.filename;
    // Skip inline text bodies (no filename) and multipart containers.
    if (attachmentId && filename) {
      found.push({
        filename,
        mimeType: part.mimeType || 'application/octet-stream',
        attachmentId,
        size: Number(part.body?.size) || 0,
      });
    }
    if (part.parts) {
      found.push(...extractAttachmentMeta(part.parts));
    }
  }
  return found;
}

// Fetch the actual bytes for each attachment and return them as data URLs.
// Oversized attachments are skipped (kept as nothing rather than a broken
// reference). Failures on a single attachment don't abort the rest.
export async function fetchAttachments(
  gmail: gmail_v1.Gmail,
  messageId: string,
  metas: AttachmentMeta[],
): Promise<StoredAttachment[]> {
  const out: StoredAttachment[] = [];
  for (const meta of metas.slice(0, MAX_ATTACHMENTS)) {
    if (meta.size > MAX_ATTACHMENT_BYTES) continue;
    try {
      const res = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: meta.attachmentId,
      });
      const data = res.data.data;
      if (!data) continue;
      // Gmail returns base64url; convert to standard base64 for the data URL.
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      out.push({
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        dataUrl: `data:${meta.mimeType};base64,${base64}`,
      });
    } catch (err) {
      console.error(`[Gmail] Failed to fetch attachment ${meta.filename}:`, err);
    }
  }
  return out;
}

// Convenience: extract + fetch in one call given a full message payload.
export async function getMessageAttachments(
  gmail: gmail_v1.Gmail,
  messageId: string,
  payload: gmail_v1.Schema$MessagePart | undefined,
): Promise<StoredAttachment[]> {
  const metas = extractAttachmentMeta(payload?.parts);
  if (metas.length === 0) return [];
  return fetchAttachments(gmail, messageId, metas);
}

// True for attachments the UI should render inline as an image.
export function isImageAttachment(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.startsWith('image/');
}
