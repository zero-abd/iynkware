// The wall-clock budget of a check run and the error that says it was used up. Kept apart from the run itself so
// the page can start a check and read its verdict without loading the interpreters.

/** Wall clock a check run gets before it ends with a `limit` error. */
export const CHECK_BUDGET_MS = 20_000;

export const LIMIT_MESSAGE = 'limit: the check run took too long';
