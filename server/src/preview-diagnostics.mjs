export function previewReadError(preview) {
  if (!preview) return 'No preview exists. Render first.';
  if (preview.status === 'invalidated') return 'Preview was cleared because plugin access, credentials or a package version changed. Render again.';
  if (preview.status === 'disconnected') return 'Preview belongs to a disconnected device. Render again.';
  return null; // Compile/runtime/native errors are inspectable, not permission failures.
}
export function acceptsPreviewError(preview, epoch, report) {
  return report.surface === 'preview' && preview?.id === report.snapshotID && report.viewEpoch === epoch && !previewReadError(preview);
}
export function previewResult(preview, data = {}) {
  return { ...data, status: preview?.status || 'empty', error: preview?.error || data.error || null, diagnostics: preview?.diagnostics || data.diagnostics || null };
}
