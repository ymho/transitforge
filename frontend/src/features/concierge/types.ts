export type ConciergeId =
  | "akari"
  | "rin"
  | "mia"
  | "ren"
  | "sota"
  | "nagi"
  | "koharu"
  | "haruto";

export type CompanionType =
  | "solo"
  | "partner"
  | "friends"
  | "children"
  | "family";

export type TravelInterest =
  | "sea"
  | "mountain"
  | "nature"
  | "onsen"
  | "food"
  | "railway"
  | "history"
  | "cityWalk"
  | "animals"
  | "art"
  | "themePark"
  | "shopping"
  | "architecture"
  | "photography"
  | "localCulture"
  | "festival"
  | "nightView"
  | "cafe"
  | "sake"
  | "craft"
  | "scenicDrive";

export type TransportMode =
  | "rail"
  | "car"
  | "bus"
  | "walk"
  | "bicycle"
  | "ferry";

export type BudgetLevel = "budget" | "standard" | "premium";
export type TripTempo = "relaxed" | "balanced" | "active";

export interface ConciergeProfile {
  id: ConciergeId;

  presentation: {
    name: string;
    image: string;
    role: string;
    oneLine: string;
    shortBio: string;
    introduction: string;
    specialties: string[];
    tags: string[];
  };

  personality: {
    keywords: string[];
    traits: {
      extroversion: number;
      calmness: number;
      curiosity: number;
      adventurousness: number;
      empathy: number;
      spontaneity: number;
      meticulousness: number;
      playfulness: number;
    };
    values: string[];
    dislikes: string[];
    worldview: string;
  };

  conversation: {
    voice: {
      firstPerson: string;
      addressUser?: string;
      politeness: "casual" | "polite" | "formal";
      sentenceEndings: string[];
      warmth: number;
      humor: number;
      emoji: "none" | "restrained" | "friendly";
      verbosity: "concise" | "balanced" | "detailed";
    };
    greeting: string;
    catchphrases: string[];
    speakingRules: string[];
    avoidPhrases: string[];
    interactionStyle: {
      asksQuestions: number;
      proactivelySuggests: number;
      challengesUser: number;
      reassuresUser: number;
      explainsReasoning: number;
    };
    responsePatterns: {
      whenUserIsUndecided: string;
      whenUserIsTired: string;
      whenPlanIsUnrealistic: string;
      whenWeatherIsBad: string;
      whenInformationIsUncertain: string;
      whenUserRejectsSuggestion: string;
    };
  };

  travelStyle: {
    tempo: TripTempo;
    pace: number;
    interests: Partial<Record<TravelInterest, number>>;
    transport: Partial<Record<TransportMode, number>>;
    preferences: {
      famousSpots: number;
      hiddenGems: number;
      urban: number;
      rural: number;
      planned: number;
      spontaneous: number;
      relaxation: number;
      activity: number;
      morningActivity: number;
      nightActivity: number;
      longDistanceTolerance: number;
      walkingTolerance: number;
      crowdTolerance: number;
      weatherTolerance: number;
      foodAdventurousness: number;
      photographyImportance: number;
      localInteraction: number;
      seasonalSensitivity: number;
    };
    budgetAffinity: Partial<Record<BudgetLevel, number>>;
    idealTripDescription: string;
    weakSituations: string[];
  };

  assignment: {
    recommendedFor: CompanionType[];
    affinity: {
      companions: Partial<Record<CompanionType, number>>;
      interests: Partial<Record<TravelInterest, number>>;
    };
    preferredPaceRange: [number, number];
    strongMatches: string[];
    weakMatches: string[];
    exclusionHints?: string[];
    priority: number;
  };

  lore: {
    favoriteThings: string[];
    travelPhilosophy: string;
    fictionalBackground: string;
  };
}
