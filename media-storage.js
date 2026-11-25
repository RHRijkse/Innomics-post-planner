/* Postplanner V1: binary files in Storage; only references in post/idea JSON. */
(function (global) {
  "use strict";
  const bucket = "postplanner-media";
  const maxInputBytes = 10 * 1024 * 1024;
  const maxDimension = 1600;
  const targetBytes = 650 * 1024;
  const urls = new Map();
  let client;

  function configure(value) { client = value; }
  function requireClient() {
    if (!client) throw new Error("Geen verbinding met de bestandsopslag. Probeer het opnieuw zodra je online bent.");
  }
  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Foto verkleinen lukte niet.")), type, quality));
  }
  async function compress(file) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Kies een JPG-, PNG-, WebP- of GIF-afbeelding.");
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Deze afbeelding kon niet worden gelezen."));
        image.src = objectUrl;
      });
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Deze browser kan de foto niet verkleinen.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // WebP preserves transparency. GIFs become a still image (stated in the picker).
      let result = await canvasBlob(canvas, "image/webp", .82);
      for (const quality of [.72, .62]) {
        if (result.size <= targetBytes) break;
        result = await canvasBlob(canvas, "image/webp", quality);
      }
      // Keep a smaller original only if it also meets the dimension limit; never upscale.
      if (file.type !== "image/gif" && scale === 1 && file.size < result.size) result = file;
      return { blob: result, width: canvas.width, height: canvas.height };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  async function upload(file, { image = file.type.startsWith("image/") } = {}) {
    requireClient();
    if (!file.size || file.size > maxInputBytes) throw new Error("Kies een bestand van maximaal 10 MB dat niet leeg is.");
    const prepared = image ? await compress(file) : { blob: file };
    const body = prepared.blob;
    const extensions = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };
    const extension = extensions[body.type] || "bin";
    const storagePath = `planner/${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from(bucket).upload(storagePath, body, {
      contentType: body.type || "application/octet-stream", cacheControl: "3600", upsert: false
    });
    if (error) throw new Error(`Upload mislukt: ${error.message}. Controleer of de foto-opslag is ingericht en probeer opnieuw.`);
    const reference = { name: file.name || "bijlage", type: body.type || "application/octet-stream", size: body.size,
      originalSize: file.size, storageBucket: bucket, storagePath,
      ...(image ? { width: prepared.width, height: prepared.height } : {}) };
    // Signing failure must not discard a successful upload/reference. A later render retries.
    try { await resolveAll([reference]); } catch (error) { console.warn(error.message); }
    return reference;
  }
  function source(attachment) {
    if (!attachment) return "";
    if (attachment.storagePath) {
      const cached = urls.get(attachment.storagePath);
      return cached && cached.expires > Date.now() ? cached.url : "";
    }
    return /^data:image\/(jpeg|png|webp|gif);base64,/i.test(attachment.dataUrl || "") ? attachment.dataUrl : "";
  }
  async function resolveAll(attachments) {
    const paths = [...new Set(attachments.filter(item => item?.storageBucket === bucket && item.storagePath)
      .map(item => item.storagePath))].filter(key => !urls.has(key) || urls.get(key).expires <= Date.now() + 60000);
    if (!paths.length) return;
    requireClient();
    const { data, error } = await client.storage.from(bucket).createSignedUrls(paths, 3600);
    if (error) throw new Error(`Foto’s laden mislukt: ${error.message}`);
    for (const item of data || []) {
      if (item.signedUrl && !item.error) urls.set(item.path, { url: item.signedUrl, expires: Date.now() + 3500000 });
    }
    if ((data || []).some(item => item.error)) throw new Error("Een of meer opgeslagen foto’s konden niet worden geladen.");
  }
  function legacy(attachment) { return Boolean(attachment?.dataUrl && !attachment.storagePath); }
  async function migrate(attachment) {
    if (!legacy(attachment)) return attachment;
    if (!/^data:[^,]*;base64,/.test(attachment.dataUrl)) throw new Error("Oude bijlage heeft een onbekend bestandsformaat.");
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], attachment.name || "bijlage", { type: attachment.type || blob.type });
    const reference = await upload(file);
    return { ...reference, ...(attachment.id ? { id: attachment.id } : {}) };
  }
  global.PlannerMedia = { configure, compress, upload, source, resolveAll, legacy, migrate, bucket };
})(globalThis);
