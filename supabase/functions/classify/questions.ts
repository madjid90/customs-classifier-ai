// ============================================================================
// QUESTIONS INTELLIGENTES - Sélection automatique selon contexte
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

export interface SmartQuestion {
  id: string;
  label: string;
  type: "yesno" | "select" | "text";
  options?: Array<{ value: string; label: string }>;
  required: boolean;
  chapter_hint?: string[];
  priority: number; // Plus bas = plus important
}

// ============================================================================
// BANQUE DE QUESTIONS PAR DOMAINE
// ============================================================================

const TEXTILE_QUESTIONS: SmartQuestion[] = [
  {
    id: "q_textile_composition",
    label: "Quelle est la matière principale du textile (>50% du poids)?",
    type: "select",
    options: [
      { value: "coton", label: "Coton" },
      { value: "polyester", label: "Polyester" },
      { value: "laine", label: "Laine" },
      { value: "soie", label: "Soie naturelle" },
      { value: "lin", label: "Lin" },
      { value: "synthetique_autre", label: "Autre synthétique (nylon, acrylique)" },
      { value: "melange", label: "Mélange équilibré" },
    ],
    required: true,
    chapter_hint: ["50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63"],
    priority: 1,
  },
  {
    id: "q_textile_construction",
    label: "Comment le textile est-il fabriqué?",
    type: "select",
    options: [
      { value: "tricote", label: "Tricoté (maille, jersey)" },
      { value: "tisse", label: "Tissé (chaîne et trame)" },
      { value: "non_tisse", label: "Non-tissé (feutre, intissé)" },
      { value: "dentelle", label: "Dentelle ou broderie" },
    ],
    required: true,
    chapter_hint: ["60", "61", "62"],
    priority: 2,
  },
  {
    id: "q_textile_usage",
    label: "Quel est l'usage principal du produit?",
    type: "select",
    options: [
      { value: "vetement_dessus", label: "Vêtement de dessus (veste, pantalon)" },
      { value: "vetement_dessous", label: "Sous-vêtement ou lingerie" },
      { value: "accessoire", label: "Accessoire (écharpe, cravate)" },
      { value: "linge_maison", label: "Linge de maison (draps, serviettes)" },
      { value: "technique", label: "Usage technique/industriel" },
    ],
    required: true,
    chapter_hint: ["61", "62", "63"],
    priority: 3,
  },
];

const MACHINE_QUESTIONS: SmartQuestion[] = [
  {
    id: "q_machine_function",
    label: "Quelle est la fonction principale de cette machine?",
    type: "text",
    required: true,
    chapter_hint: ["84", "85"],
    priority: 1,
  },
  {
    id: "q_machine_type",
    label: "Quel type de machine est-ce?",
    type: "select",
    options: [
      { value: "production", label: "Machine de production industrielle" },
      { value: "bureau", label: "Machine de bureau" },
      { value: "menager", label: "Appareil ménager" },
      { value: "agricole", label: "Machine agricole" },
      { value: "construction", label: "Machine de construction" },
    ],
    required: true,
    chapter_hint: ["84"],
    priority: 2,
  },
  {
    id: "q_machine_electric",
    label: "La machine fonctionne-t-elle principalement à l'électricité?",
    type: "yesno",
    required: true,
    chapter_hint: ["84", "85"],
    priority: 3,
  },
  {
    id: "q_machine_autonomous",
    label: "La machine fonctionne-t-elle de manière autonome ou fait-elle partie d'un ensemble?",
    type: "select",
    options: [
      { value: "autonome", label: "Fonctionne de manière autonome" },
      { value: "partie", label: "Partie/composant d'une machine plus grande" },
      { value: "accessoire", label: "Accessoire interchangeable" },
    ],
    required: true,
    chapter_hint: ["84", "85"],
    priority: 4,
  },
];

const FOOD_QUESTIONS: SmartQuestion[] = [
  {
    id: "q_food_state",
    label: "Dans quel état est le produit alimentaire?",
    type: "select",
    options: [
      { value: "vivant", label: "Vivant" },
      { value: "frais", label: "Frais/réfrigéré" },
      { value: "congele", label: "Congelé" },
      { value: "seche", label: "Séché" },
      { value: "conserve", label: "En conserve/préparé" },
    ],
    required: true,
    chapter_hint: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "16", "19", "20", "21"],
    priority: 1,
  },
  {
    id: "q_food_preparation",
    label: "Le produit contient-il du sucre ajouté, des arômes ou des additifs?",
    type: "yesno",
    required: true,
    chapter_hint: ["17", "18", "19", "20", "21"],
    priority: 2,
  },
  {
    id: "q_food_origin",
    label: "Quelle est l'origine du produit?",
    type: "select",
    options: [
      { value: "animal", label: "Origine animale" },
      { value: "vegetal", label: "Origine végétale" },
      { value: "mixte", label: "Mixte (animal et végétal)" },
    ],
    required: true,
    chapter_hint: ["01", "02", "03", "04", "07", "08", "09", "10", "11", "12"],
    priority: 3,
  },
];

const CHEMICAL_QUESTIONS: SmartQuestion[] = [
  {
    id: "q_chemical_purity",
    label: "Le produit chimique est-il à l'état pur ou est-ce un mélange?",
    type: "select",
    options: [
      { value: "pur", label: "Produit chimiquement défini (pur)" },
      { value: "melange", label: "Mélange/préparation" },
      { value: "technique", label: "Qualité technique (pureté partielle)" },
    ],
    required: true,
    chapter_hint: ["28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38"],
    priority: 1,
  },
  {
    id: "q_chemical_usage",
    label: "Quelle est la destination d'usage du produit?",
    type: "select",
    options: [
      { value: "industriel", label: "Usage industriel" },
      { value: "pharmaceutique", label: "Usage pharmaceutique/médical" },
      { value: "cosmetique", label: "Usage cosmétique" },
      { value: "agricole", label: "Usage agricole (engrais, pesticides)" },
      { value: "alimentaire", label: "Additif alimentaire" },
      { value: "domestique", label: "Usage domestique" },
    ],
    required: true,
    chapter_hint: ["28", "29", "30", "31", "32", "33", "34", "35", "38"],
    priority: 2,
  },
];

const METAL_QUESTIONS: SmartQuestion[] = [
  {
    id: "q_metal_type",
    label: "Quel est le métal principal?",
    type: "select",
    options: [
      { value: "fer_acier", label: "Fer ou acier" },
      { value: "fonte", label: "Fonte" },
      { value: "acier_inox", label: "Acier inoxydable" },
      { value: "aluminium", label: "Aluminium" },
      { value: "cuivre", label: "Cuivre ou alliages (laiton, bronze)" },
      { value: "zinc", label: "Zinc" },
      { value: "plomb", label: "Plomb" },
      { value: "precieux", label: "Métal précieux (or, argent, platine)" },
    ],
    required: true,
    chapter_hint: ["72", "73", "74", "75", "76", "78", "79", "80", "81", "82", "83"],
    priority: 1,
  },
  {
    id: "q_metal_form",
    label: "Sous quelle forme se présente le produit métallique?",
    type: "select",
    options: [
      { value: "brut", label: "Brut (lingot, billette)" },
      { value: "semifini", label: "Semi-fini (tôle, fil, tube)" },
      { value: "ouvrage", label: "Article ouvré/fini" },
      { value: "dechet", label: "Déchet ou débris" },
    ],
    required: true,
    chapter_hint: ["72", "73", "74", "75", "76"],
    priority: 2,
  },
];

const VEHICLE_QUESTIONS: SmartQuestion[] = [
  {
    id: "q_vehicle_type",
    label: "Quel type de véhicule est-ce?",
    type: "select",
    options: [
      { value: "voiture", label: "Voiture de tourisme" },
      { value: "utilitaire", label: "Véhicule utilitaire/camion" },
      { value: "moto", label: "Motocycle/scooter" },
      { value: "velo", label: "Vélo/cycle" },
      { value: "remorque", label: "Remorque" },
      { value: "agricole", label: "Véhicule agricole/tracteur" },
    ],
    required: true,
    chapter_hint: ["87"],
    priority: 1,
  },
  {
    id: "q_vehicle_capacity",
    label: "Quelle est la cylindrée ou capacité du moteur?",
    type: "select",
    options: [
      { value: "moins_1000", label: "Moins de 1000 cm³" },
      { value: "1000_1500", label: "1000 à 1500 cm³" },
      { value: "1500_3000", label: "1500 à 3000 cm³" },
      { value: "plus_3000", label: "Plus de 3000 cm³" },
      { value: "electrique", label: "Moteur électrique" },
      { value: "sans_moteur", label: "Sans moteur" },
    ],
    required: true,
    chapter_hint: ["87"],
    priority: 2,
  },
];

const GENERAL_QUESTIONS: SmartQuestion[] = [
  {
    id: "q_general_description",
    label: "Décrivez le produit en détail (matière, fonction, composition)",
    type: "text",
    required: true,
    priority: 10,
  },
  {
    id: "q_general_usage",
    label: "Quel est l'usage principal prévu pour ce produit?",
    type: "text",
    required: true,
    priority: 11,
  },
  {
    id: "q_general_material",
    label: "De quelle(s) matière(s) est composé le produit?",
    type: "text",
    required: true,
    priority: 12,
  },
];

// ============================================================================
// MAPPING CHAPITRE → QUESTIONS
// ============================================================================

const CHAPTER_QUESTION_MAP: Record<string, SmartQuestion[]> = {
  // Textiles
  "50": TEXTILE_QUESTIONS,
  "51": TEXTILE_QUESTIONS,
  "52": TEXTILE_QUESTIONS,
  "53": TEXTILE_QUESTIONS,
  "54": TEXTILE_QUESTIONS,
  "55": TEXTILE_QUESTIONS,
  "56": TEXTILE_QUESTIONS,
  "57": TEXTILE_QUESTIONS,
  "58": TEXTILE_QUESTIONS,
  "59": TEXTILE_QUESTIONS,
  "60": TEXTILE_QUESTIONS,
  "61": TEXTILE_QUESTIONS,
  "62": TEXTILE_QUESTIONS,
  "63": TEXTILE_QUESTIONS,
  
  // Machines
  "84": MACHINE_QUESTIONS,
  "85": MACHINE_QUESTIONS,
  
  // Aliments
  "01": FOOD_QUESTIONS,
  "02": FOOD_QUESTIONS,
  "03": FOOD_QUESTIONS,
  "04": FOOD_QUESTIONS,
  "07": FOOD_QUESTIONS,
  "08": FOOD_QUESTIONS,
  "09": FOOD_QUESTIONS,
  "10": FOOD_QUESTIONS,
  "11": FOOD_QUESTIONS,
  "12": FOOD_QUESTIONS,
  "16": FOOD_QUESTIONS,
  "17": FOOD_QUESTIONS,
  "18": FOOD_QUESTIONS,
  "19": FOOD_QUESTIONS,
  "20": FOOD_QUESTIONS,
  "21": FOOD_QUESTIONS,
  
  // Chimie
  "28": CHEMICAL_QUESTIONS,
  "29": CHEMICAL_QUESTIONS,
  "30": CHEMICAL_QUESTIONS,
  "31": CHEMICAL_QUESTIONS,
  "32": CHEMICAL_QUESTIONS,
  "33": CHEMICAL_QUESTIONS,
  "34": CHEMICAL_QUESTIONS,
  "35": CHEMICAL_QUESTIONS,
  "38": CHEMICAL_QUESTIONS,
  
  // Métaux
  "72": METAL_QUESTIONS,
  "73": METAL_QUESTIONS,
  "74": METAL_QUESTIONS,
  "75": METAL_QUESTIONS,
  "76": METAL_QUESTIONS,
  "78": METAL_QUESTIONS,
  "79": METAL_QUESTIONS,
  "80": METAL_QUESTIONS,
  "81": METAL_QUESTIONS,
  "82": METAL_QUESTIONS,
  "83": METAL_QUESTIONS,
  
  // Véhicules
  "87": VEHICLE_QUESTIONS,
};

// ============================================================================
// SÉLECTION INTELLIGENTE DE QUESTION
// ============================================================================

export interface SmartQuestionContext {
  candidates: Array<{ code_10: string; chapter_2: string; label_fr: string }>;
  previousAnswers: Record<string, string>;
  productProfile: {
    product_name: string;
    description: string;
    material_composition: string[];
  };
}

export function getSmartQuestion(context: SmartQuestionContext): SmartQuestion | null {
  const { candidates, previousAnswers, productProfile } = context;
  
  if (candidates.length === 0) {
    // Pas de candidats → question générale
    return GENERAL_QUESTIONS[0];
  }

  // Identifier les chapitres des candidats
  const chapters = new Set(candidates.map(c => c.chapter_2));
  
  // Trouver les questions pertinentes
  let relevantQuestions: SmartQuestion[] = [];
  
  for (const chapter of chapters) {
    const chapterQuestions = CHAPTER_QUESTION_MAP[chapter];
    if (chapterQuestions) {
      relevantQuestions.push(...chapterQuestions);
    }
  }
  
  // Dédupliquer par ID
  const seenIds = new Set<string>();
  relevantQuestions = relevantQuestions.filter(q => {
    if (seenIds.has(q.id)) return false;
    seenIds.add(q.id);
    return true;
  });

  // Si pas de questions spécifiques, utiliser les générales
  if (relevantQuestions.length === 0) {
    relevantQuestions = GENERAL_QUESTIONS;
  }

  // Filtrer les questions déjà répondues
  relevantQuestions = relevantQuestions.filter(q => !previousAnswers[q.id]);

  // Vérifier si certaines infos sont déjà disponibles
  relevantQuestions = relevantQuestions.filter(q => {
    // Si on a déjà la composition, ne pas demander
    if (q.id.includes("composition") && productProfile.material_composition.length > 0) {
      return false;
    }
    return true;
  });

  if (relevantQuestions.length === 0) {
    return null; // Toutes les questions ont été répondues
  }

  // Trier par priorité et retourner la plus importante
  relevantQuestions.sort((a, b) => a.priority - b.priority);
  
  return relevantQuestions[0];
}

// ============================================================================
// ANALYSE DES RÉPONSES
// ============================================================================

export function analyzeAnswer(
  questionId: string,
  answer: string
): { keywords: string[]; hints: string[] } {
  const keywords: string[] = [];
  const hints: string[] = [];
  
  // Extraire des mots-clés de la réponse
  const answerLower = answer.toLowerCase();
  
  // Textile
  if (questionId === "q_textile_composition") {
    keywords.push(answer);
    if (answer === "coton") hints.push("ch52");
    if (answer === "laine") hints.push("ch51");
    if (answer === "soie") hints.push("ch50");
  }
  
  if (questionId === "q_textile_construction") {
    if (answer === "tricote") hints.push("ch61");
    if (answer === "tisse") hints.push("ch62");
  }
  
  // Machines
  if (questionId === "q_machine_electric") {
    if (answer === "oui" || answer === "yes" || answer === "true") {
      hints.push("ch85");
    } else {
      hints.push("ch84");
    }
  }
  
  return { keywords, hints };
}
