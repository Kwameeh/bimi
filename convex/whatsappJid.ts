export function canonicalWhatsAppJid(remoteJid: string, remoteJidAlt?: string): string {
  if (remoteJid.endsWith("@lid") && remoteJidAlt?.endsWith("@s.whatsapp.net")) {
    return remoteJidAlt;
  }
  return remoteJid;
}
