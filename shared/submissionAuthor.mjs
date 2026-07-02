// Shared by the Express server (server/status.mjs) and the React client
// (src/App.jsx). Both run as ESM — node at runtime, vite at build — so a single
// module removes the previously-divergent duplicate implementations.
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
