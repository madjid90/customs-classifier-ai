# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Lovable Cloud (Supabase) for backend

## Alimentation automatique des données

L'application peut scraper automatiquement les sites officiels de douane pour maintenir la base de connaissances à jour.

### Configuration

1. Accédez à **Admin > Sources automatiques**
2. Ajoutez une nouvelle source avec:
   - URL du site à scraper
   - Sélecteurs CSS pour extraire le contenu
   - Planning de mise à jour (expression CRON)
   - Type de source (OMD, Maroc, Lois, DUM)

### Fonctionnement

- Chaque source a son planning de mise à jour configurable (CRON)
- Le scraping peut être lancé manuellement ou automatiquement
- Les nouvelles données sont automatiquement découpées en chunks et indexées
- Les embeddings vectoriels sont générés pour la recherche sémantique

### Sources pré-configurées

| Source | Site | Description |
|--------|------|-------------|
| ADII | douane.gov.ma | Administration des Douanes Maroc |
| SGG | sgg.gov.ma | Secrétariat Général du Gouvernement |

## Recherche externe

Si la base de données interne ne contient pas assez d'informations (moins de 3 résultats), le système peut automatiquement rechercher sur les sites officiels.

### Fonctionnement

- Déclenchement automatique quand les résultats internes sont insuffisants
- Interrogation des portails officiels via l'API Serper (Google Search)
- Les résultats externes sont marqués distinctement avec leur source
- Timeout de 10 secondes pour maintenir les performances

### Sources interrogées

| Source | Site | Description |
|--------|------|-------------|
| ADII | douane.gov.ma | Administration des Douanes Maroc |
| EU TARIC | ec.europa.eu | Base tarifaire européenne |
| OMD | wcoomd.org | Organisation Mondiale des Douanes |

### Configuration

1. Obtenez une clé API sur [Serper.dev](https://serper.dev) (2500 recherches gratuites/mois)
2. Configurez le secret `SERPER_API_KEY` dans Lovable Cloud
3. Optionnel: désactivez avec `EXTERNAL_SEARCH_ENABLED=false`

## Variables d'environnement

### Sécurité

| Variable | Description | Requis |
|----------|-------------|--------|
| `CUSTOM_JWT_SECRET` | Clé secrète pour signer/vérifier les JWT d'authentification. Si non définie, la clé par défaut est utilisée. Générer avec `openssl rand -base64 32` | Non |
| `ALLOWED_ORIGINS` | Domaines supplémentaires autorisés pour CORS (séparés par virgules). Les domaines `*.lovable.app` sont toujours autorisés. | Non |
| `ENVIRONMENT` | Mode environnement: `development` autorise localhost, sinon production par défaut | Non |

### Recherche externe

| Variable | Description | Requis |
|----------|-------------|--------|
| `SERPER_API_KEY` | Clé API Serper pour la recherche Google sur les sites de douane | Non |
| `EXTERNAL_SEARCH_ENABLED` | Active/désactive la recherche externe (`true` par défaut si `SERPER_API_KEY` est configurée) | Non |

### IA et Classification

| Variable | Description | Requis |
|----------|-------------|--------|
| `OPENAI_API_KEY` | Clé API OpenAI pour la classification HS et l'extraction de données | Oui |
| `OPENAI_MODEL` | Modèle OpenAI à utiliser (défaut: `gpt-4o`) | Non |
| `OPENAI_VISION_MODEL` | Modèle pour l'analyse d'images (défaut: `gpt-4o`) | Non |

## Tests

Le projet utilise Vitest pour les tests unitaires:

```sh
# Lancer tous les tests
npm test

# Lancer les tests en mode watch
npm run test:watch
```

### Tests disponibles

- `src/test/hs-code-utils.test.ts` - Utilitaires de codes HS
- `src/test/external-search.test.ts` - Recherche externe

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
