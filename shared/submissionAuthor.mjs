// Used by the Express server (server/status.mjs). Kept in shared/ (ESM, run by
// both node and vite) so the React client can adopt it without a second copy.
export function inferSubmissionAuthorFromId(submissionId) {
  if (!submissionId) {
    return null;
  }
  if (submissionId.startsWith("kata-init")) {
    return "Kata Seed";
  }
  const match = submissionId.match(/^([a-zA-Z0-9-]+)-\d{8}-\d+$/);
  return match ? match[1] : submissionId;
}
