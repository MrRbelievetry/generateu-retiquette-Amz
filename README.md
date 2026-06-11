# LabelMaker Amazon Web

Application web statique pour générer des étiquettes d'expédition à partir d'un PDF Amazon.

## Fonctionnalités V1

- Import d'un PDF Amazon depuis le navigateur
- Extraction des adresses d'expédition
- Génération d'un PDF d'étiquettes, une étiquette par page
- Adresse expéditeur en haut à gauche
- Option pour encadrer et barrer l'adresse expéditeur
- Mémorisation automatique de l'adresse expéditeur dans le navigateur
- Aucun serveur : tout se fait côté navigateur

## Déploiement GitHub Pages

1. Créer un dépôt GitHub, par exemple `labelmaker-amazon-web`.
2. Envoyer les fichiers :
   - `index.html`
   - `style.css`
   - `app.js`
   - `README.md`
3. Aller dans `Settings` > `Pages`.
4. Choisir la branche `main` et le dossier `/root`.
5. Enregistrer.

L'application sera disponible à l'adresse :

```text
https://VOTRE-COMPTE.github.io/labelmaker-amazon-web/
```

## Confidentialité

Le PDF Amazon est traité directement dans le navigateur. Il n'est pas envoyé à un serveur.

## Correctif V1.1
- Fusion automatique du code postal et de la ville sur une seule ligne.
- Ligne code postal + ville affichée en plus gros pour faciliter la lecture postale.
- Ville convertie en majuscules dans le PDF généré.
