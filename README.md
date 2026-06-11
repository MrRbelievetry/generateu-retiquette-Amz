# Label Maker V3

Application web statique pour générer des étiquettes d'expédition à partir d'un PDF Amazon.

## Fonctionnalités V3

- Import d'un PDF Amazon depuis le navigateur
- Extraction des adresses d'expédition
- Génération d'un PDF d'étiquettes, une étiquette par page
- Adresse expéditeur en haut à gauche
- Option pour encadrer et barrer l'adresse expéditeur
- Mémorisation automatique de l'adresse expéditeur dans le navigateur
- Code postal + ville sur une seule ligne
- Ville en majuscules
- Ligne CP + VILLE plus grande avec taille adaptative pour rester sur une seule ligne
- Suppression du libellé "Destinataire" sur les étiquettes
- Bloc adresse mieux centré verticalement
- Aucun serveur : tout se fait côté navigateur

## Déploiement GitHub Pages

1. Envoyer les fichiers à la racine du dépôt :
   - `index.html`
   - `style.css`
   - `app.js`
   - `README.md`
2. Aller dans `Settings` > `Pages`.
3. Choisir la branche `main` et le dossier `/root`.
4. Enregistrer.

## Confidentialité

Le PDF Amazon est traité directement dans le navigateur. Il n'est pas envoyé à un serveur.
