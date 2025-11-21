# Architecture générale du GitHub
 - les fichiers nécessaires au fonctionnement du site sont dans le dossier "Libtech" (le chemin est donc Libtech/Libtech/...)
 - Les fichiers a l'extérieur sont la pour être transférés entre les différents ordinateurs
 - le fichier "A faire" est une liste de suggestion pour améliorer le site. Il a servi au cour de l'année entre nous mais nous permet aussi de vous communiquer les problèmes que nous n'avons pas pu résoudre.

# Les fichiers du site


## index.html – Structure et contenu statique

Ce fichier contient l’ossature générale du site.
Il s’agit du fichier qui décrit la structure et les éléments visibles du site.
Il définit :
 - la structure des pages (header, navigation, footer, zone de contenu),
 - les différents écrans statiques (Accueil, À propos, Contact, etc.),
 - les emplacements où seront injectés les contenus dynamiques,
 - les liens internes de navigation via les ancres #/….

## style.css – Mise en forme et présentation

Ce fichier regroupe l’ensemble des règles de style.
Il s’agit du fichier responsable de l’apparence visuelle du site.
Il contrôle notamment :
 - la disposition des blocs,
 - les couleurs, marges, polices et tailles,
 - l’aspect du header, du footer, des cartes et des fiches détaillées,
 - l’adaptation de l’interface aux écrans mobiles ou larges.
 - tout ce qui est "pour faire beau" en gros

## app.js – Fonctions et logique du site "en temps réel"

Ce fichier contient la logique de fonctionnement du site.
Il s’agit du fichier qui exécute la récupération des données et toute la partie dynamique.
Il assure :
 - le chargement et l’analyse du fichier CSV issu de Google Sheets,
 - l’interprétation des colonnes et la création des filtres,
 - la génération dynamique de l'affichages des techs (appelé "cards" dans le code)(facile a retenir : ça ressemble a des cartes visuellement) et des fiches détaillées (une fois que tu clique sur les cards),
 - la gestion des interactions (filtres, recherche, affichage des détails),
 - la gestion de la navigation interne via le hash(#) dans l’URL,
 - la mise à jour automatique de la vue en fonction de l’état de l’application.

### basiquement (p'tite métaphore du corp humain):
 - index.html = squelette
 - app.js = muscles et cerveau
 - style.css = maquillage, vêtements

### aide de comprehension de l'architecture du site

N'hesitez pas a faire "ctrl+maj+C" puis a survoler la page avec le curseur lorsque vous êtes sur le site de LibTech pour savoir a quelle ligne correspond chaque zone (la ligne peut se trouver dans le HTML ou dans le JavaScript). Vous pouvez ensuite faire "Ctrl+F" sur votre logiciel de traitement de texte pour retrouver l'emplacement de la ligne.
