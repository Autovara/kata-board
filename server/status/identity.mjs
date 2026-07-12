// Contributor identity aliasing: map submission ids / inferred authors to the
// canonical GitHub login so round entrants and kings display consistently.
import { inferSubmissionAuthorFromId } from "../../shared/submissionAuthor.mjs";

export function buildIdentityAliases({ validator, round }) {
  const aliases = new Map();
  for (const entrant of round?.entrants || []) {
    const login = entrant?.author || null;
    const submissionId = entrant?.submission_id || entrant?.submissionId || null;
    if (!login || !submissionId) {
      continue;
    }
    addIdentityAlias(aliases, submissionId, login);
    addIdentityAlias(aliases, inferSubmissionAuthorFromId(submissionId), login);
  }
  const active = validator?.activeEvaluation || null;
  const login = active?.candidateGithubLogin || active?.candidateAuthor || null;
  const pullNumber = active?.pullNumber || null;
  if (!login || !pullNumber || active?.finalAction !== "merge") {
    return aliases;
  }
  const winnerEntrant = (round?.entrants || []).find(
    (entrant) => entrant?.pull_number === pullNumber
  );
  if (!winnerEntrant?.submission_id) {
    return aliases;
  }
  addIdentityAlias(aliases, winnerEntrant.submission_id, login);
  addIdentityAlias(
    aliases,
    inferSubmissionAuthorFromId(winnerEntrant.submission_id),
    login
  );
  return aliases;
}

export function addIdentityAlias(aliases, from, to) {
  const source = String(from || "").trim();
  const target = String(to || "").trim();
  if (!source || !target || source === target) {
    return;
  }
  aliases.set(source, target);
  aliases.set(source.toLowerCase(), target);
}

export function resolveAuthorAlias(author, aliases = new Map()) {
  const value = String(author || "").trim();
  if (!value) {
    return author;
  }
  return aliases.get(value) || aliases.get(value.toLowerCase()) || author;
}

export function applyRoundIdentityAliases(round, identityAliases = new Map()) {
  if (!round) {
    return round;
  }
  return {
    ...round,
    kingAuthor: resolveAuthorAlias(round.kingAuthor, identityAliases),
    entrants: (round.entrants || []).map((entrant) => ({
      ...entrant,
      author: resolveAuthorAlias(entrant.author, identityAliases)
    }))
  };
}
