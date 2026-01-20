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

## Configuration recherche externe

La recherche externe permet d'interroger les sites officiels de douane (ADII Maroc, EU TARIC, OMD) quand la base de données interne ne contient pas assez de résultats.

### Obtenir une clé API Serper

1. Créez un compte sur [Serper.dev](https://serper.dev)
2. Obtenez votre clé API depuis le dashboard
3. Serper offre 2500 recherches gratuites par mois

### Configurer la variable d'environnement

Dans Lovable Cloud, ajoutez le secret `SERPER_API_KEY` avec votre clé API.

La recherche externe est **optionnelle** et se déclenche uniquement quand :
- La base interne retourne moins de 3 résultats
- `EXTERNAL_SEARCH_ENABLED` n'est pas défini à `false`
- `SERPER_API_KEY` est configurée

Pour désactiver la recherche externe même si la clé est configurée, ajoutez le secret :
```
EXTERNAL_SEARCH_ENABLED=false
```

### Sources interrogées

| Source | Site | Description |
|--------|------|-------------|
| ADII | douane.gov.ma | Administration des Douanes Maroc |
| EU TARIC | ec.europa.eu | Base tarifaire européenne |
| OMD | wcoomd.org | Organisation Mondiale des Douanes |

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
