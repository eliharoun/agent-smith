/** RRF rank-fusion smoothing constant. */
export const RRF_C = 60;
/** Minimum cosine similarity for a dense hit to enter RRF fusion. Below this a
 *  result is treated as semantically irrelevant and dropped BEFORE fusion, so
 *  an always-full secondary dense arm (e.g. the prose arm on a code query)
 *  cannot inject rank-1..k noise. Conservative; tune with a fixture. */
export const SIM_FLOOR = 0.25;
