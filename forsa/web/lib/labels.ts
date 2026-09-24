/** Bid lifecycle labels (mirrors services/bids.TRANSITIONS). */
export const BID_STATUS: Record<string, { fr: string; en: string }> = {
  QUALIFYING: { fr: "Qualification", en: "Qualifying" }, PURSUING: { fr: "Préparation", en: "Preparing" },
  IN_REVIEW: { fr: "En revue", en: "In review" }, APPROVED: { fr: "Approuvée", en: "Approved" },
  SUBMITTED: { fr: "Soumise", en: "Submitted" }, WON: { fr: "Gagnée", en: "Won" }, LOST: { fr: "Perdue", en: "Lost" },
  NO_BID: { fr: "Non soumise", en: "No bid" }, WITHDRAWN: { fr: "Retirée", en: "Withdrawn" },
  CANCELLED: { fr: "Annulée", en: "Cancelled" },
};
export const BID_ACTIVE = new Set(["QUALIFYING", "PURSUING", "IN_REVIEW", "APPROVED"]);
export const BID_STAGES = ["QUALIFYING", "PURSUING", "IN_REVIEW", "APPROVED", "SUBMITTED"] as const;
