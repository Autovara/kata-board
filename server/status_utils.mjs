// Pure shared numeric/string/date utilities used across the status pipeline.

export function uniqueStrings(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ),
  ];
}


export function normalizeLabelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => String(label?.name || label || "").trim())
    .filter(Boolean);
}


export function dateIsAfter(left, right) {
  if (!left) {
    return false;
  }
  const leftTime = new Date(left).getTime();
  const rightTime = right ? new Date(right).getTime() : 0;
  return Number.isFinite(leftTime) && leftTime > (Number.isFinite(rightTime) ? rightTime : 0);
}


export function numbersClose(left, right) {
  if (left == null || right == null) {
    return true;
  }
  return Math.abs(Number(left) - Number(right)) < 1e-9;
}


export function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}


export function f1Score(detectionRate, precision) {
  const recall = Number(detectionRate || 0);
  const precise = Number(precision || 0);
  return recall + precise > 0 ? (2 * recall * precise) / (recall + precise) : 0;
}


export function summarizeTaskStatusCounts(taskStatuses) {
  const counts = {};
  for (const task of taskStatuses) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }
  return counts;
}


export function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
