# Architecture générale
 - les fichiers nécessaires au fonctionnement du site sont dans le dossier "Libtech" (le chemin est donc Libtech/Libtech/...)
 - Les fichiers a l'extérieur sont la pour être transférés entre les différents ordinateurs
 - le fichier "A faire" est plus pour l'année en cours pour se souvenir de tous ce qu'il reste a faire.

# Les fichiers du site


## index.html – Structure et contenu statique

Ce fichier contient l’ossature générale du site.
Il définit :
 - la structure des pages (header, navigation, footer, zone de contenu),
 - les différents écrans statiques (Accueil, À propos, Contact, etc.),
 - les emplacements où seront injectés les contenus dynamiques,
 - les liens internes de navigation via les ancres #/….
Il s’agit du fichier qui décrit la structure et les éléments visibles du site.

## style.css – Mise en forme et présentation

Ce fichier regroupe l’ensemble des règles de style.
Il contrôle notamment :
 - la disposition des blocs,
 - les couleurs, marges, polices et tailles,
 - l’aspect du header, du footer, des cartes et des fiches détaillées,
 - l’adaptation de l’interface aux écrans mobiles ou larges.
Il s’agit du fichier responsable de l’apparence visuelle du site.

## app.js – Fonction et logique du site

Ce fichier contient la logique de fonctionnement du site.
Il assure :
 - le chargement et l’analyse du fichier CSV issu de Google Sheets,
 - l’interprétation des colonnes et la création des filtres,
 - la génération dynamique des cartes et des fiches détaillées,
 - la gestion des interactions (filtres, recherche, affichage des détails),
 - la gestion de la navigation interne via le hash dans l’URL,
 - la mise à jour automatique de la vue en fonction de l’état de l’application.
Il s’agit du fichier qui exécute la logique métier, la récupération des données et toute la partie dynamique.
