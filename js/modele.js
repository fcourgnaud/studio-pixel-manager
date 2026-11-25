/*
 * Studio Pixel — Manager
 * modele.js : la logique des données, sans aucun affichage.
 *
 * Ce fichier décrit les 12 modules (leurs champs), et fournit les fonctions
 * pour créer, modifier, supprimer, rechercher, filtrer, calculer l'avancement,
 * le budget, les dépendances des énigmes, et exporter / importer en JSON.
 *
 * Il fonctionne aussi bien dans le navigateur (window.SPModele) que dans
 * Node.js (pour les tests automatiques : require('./modele.js')).
 */
(function (racine) {
  'use strict';

  var VERSION_DONNEES = 1;

  // Les quatre statuts communs à toutes les fiches.
  var STATUTS = [
    { cle: 'a_faire', libelle: 'À faire' },
    { cle: 'en_cours', libelle: 'En cours' },
    { cle: 'a_valider', libelle: 'À valider' },
    { cle: 'valide', libelle: 'Validé' }
  ];

  /*
   * Description des modules.
   * Types de champs : texte, zone (texte long), nombre, montant (euros),
   * date, choix (liste fermée), lien (une adresse), liens (plusieurs adresses,
   * une par ligne), image, images, audio, couleurs (codes #RRGGBB),
   * reference (une fiche d'un autre module), references (plusieurs fiches),
   * copiable (texte long avec un bouton « Copier »),
   * script (texte long du script d'une scène, grande zone avec un bouton « Copier »).
   */
  var MODULES = [
    {
      id: 'tableau', titre: 'Tableau de bord', icone: '◈', vue: 'tableau',
      description: 'Vue d\'ensemble du projet, et registre des décisions.',
      nomFiche: 'décision',
      champs: [
        { cle: 'titre', libelle: 'Décision', type: 'texte', requis: true },
        { cle: 'numero', libelle: 'Numéro', type: 'texte' },
        { cle: 'date', libelle: 'Date', type: 'date' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' },
        { cle: 'liens', libelle: 'Liens', type: 'liens' }
      ]
    },
    {
      id: 'scenario', titre: 'Scénario', icone: '✎', vue: 'liste', groupe: 'chapitre',
      description: 'Chapitres, scènes, dialogues et notes. Le script sur Drive fait foi.',
      nomFiche: 'scène',
      champs: [
        { cle: 'titre', libelle: 'Scène', type: 'texte', requis: true },
        { cle: 'chapitre', libelle: 'Chapitre', type: 'texte' },
        { cle: 'ordre', libelle: 'Ordre', type: 'nombre' },
        { cle: 'resume', libelle: 'Résumé', type: 'zone' },
        { cle: 'description', libelle: 'Description de la scène', type: 'zone' },
        { cle: 'script', libelle: 'Script (déroulé, actions et répliques)', type: 'script' },
        { cle: 'dialogues', libelle: 'Dialogues', type: 'zone' },
        { cle: 'decors', libelle: 'Décors', type: 'references', module: 'decors' },
        { cle: 'personnages', libelle: 'Personnages', type: 'references', module: 'personnages' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' },
        { cle: 'liens', libelle: 'Liens (Drive…)', type: 'liens' }
      ]
    },
    {
      id: 'direction', titre: 'Direction artistique', icone: '◐', vue: 'galerie', comparer: true,
      description: 'Moodboards, palettes et règles de style. Comparez deux fiches côte à côte.',
      nomFiche: 'fiche de style',
      champs: [
        { cle: 'titre', libelle: 'Titre', type: 'texte', requis: true },
        { cle: 'categorie', libelle: 'Catégorie', type: 'choix', options: ['Moodboard', 'Palette', 'Règle', 'Référence', 'Question ouverte'] },
        { cle: 'images', libelle: 'Images', type: 'images' },
        { cle: 'couleurs', libelle: 'Couleurs', type: 'couleurs' },
        { cle: 'regles', libelle: 'Règles / description', type: 'zone' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' },
        { cle: 'liens', libelle: 'Liens', type: 'liens' }
      ]
    },
    {
      id: 'personnages', titre: 'Personnages', icone: '☺', vue: 'galerie',
      description: 'Fiches, sprites, portraits, expressions et animations.',
      nomFiche: 'personnage',
      champs: [
        { cle: 'titre', libelle: 'Nom', type: 'texte', requis: true },
        { cle: 'role', libelle: 'Rôle', type: 'texte' },
        { cle: 'description', libelle: 'Description', type: 'zone' },
        { cle: 'sprites', libelle: 'Sprites', type: 'images' },
        { cle: 'portraits', libelle: 'Portraits et expressions', type: 'images' },
        { cle: 'animations', libelle: 'Animations', type: 'references', module: 'animations' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' },
        { cle: 'liens', libelle: 'Liens', type: 'liens' }
      ]
    },
    {
      id: 'decors', titre: 'Décors', icone: '▦', vue: 'galerie',
      description: 'Lieux du jeu : images, interactions, éclairage.',
      nomFiche: 'décor',
      champs: [
        { cle: 'titre', libelle: 'Décor', type: 'texte', requis: true },
        { cle: 'chapitre', libelle: 'Chapitre', type: 'texte' },
        { cle: 'description', libelle: 'Description', type: 'zone' },
        { cle: 'images', libelle: 'Images', type: 'images' },
        { cle: 'interactions', libelle: 'Interactions', type: 'zone' },
        { cle: 'eclairage', libelle: 'Éclairage', type: 'zone' },
        { cle: 'objets', libelle: 'Objets présents', type: 'references', module: 'objets' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' }
      ]
    },
    {
      id: 'objets', titre: 'Objets', icone: '⚿', vue: 'galerie',
      description: 'Inventaire et objets du décor, avec leurs énigmes et scènes.',
      nomFiche: 'objet',
      champs: [
        { cle: 'titre', libelle: 'Objet', type: 'texte', requis: true },
        { cle: 'inventaire', libelle: 'Type', type: 'choix', options: ['Inventaire', 'Décor'] },
        { cle: 'description', libelle: 'Description', type: 'zone' },
        { cle: 'images', libelle: 'Illustrations', type: 'images' },
        { cle: 'enigmes', libelle: 'Énigmes liées', type: 'references', module: 'gamedesign' },
        { cle: 'scenes', libelle: 'Scènes', type: 'references', module: 'scenario' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' }
      ]
    },
    {
      id: 'animations', titre: 'Animations', icone: '▶', vue: 'galerie',
      description: 'GIF et planches d\'animation (spritesheets).',
      nomFiche: 'animation',
      champs: [
        { cle: 'titre', libelle: 'Animation', type: 'texte', requis: true },
        { cle: 'images', libelle: 'GIF / planches', type: 'images' },
        { cle: 'images_par_seconde', libelle: 'Images par seconde', type: 'nombre' },
        { cle: 'description', libelle: 'Description', type: 'zone' },
        { cle: 'liens', libelle: 'Liens', type: 'liens' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' }
      ]
    },
    {
      id: 'gamedesign', titre: 'Game design', icone: '⚙', vue: 'liste', groupe: 'chapitre', dependances: true,
      description: 'Énigmes, dépendances (ce qui doit être fait avant) et déclencheurs.',
      nomFiche: 'énigme',
      champs: [
        { cle: 'titre', libelle: 'Énigme / action', type: 'texte', requis: true },
        { cle: 'chapitre', libelle: 'Chapitre', type: 'texte' },
        { cle: 'ordre', libelle: 'Ordre', type: 'nombre' },
        { cle: 'solution', libelle: 'Solution', type: 'zone' },
        { cle: 'prerequis', libelle: 'Nécessite d\'abord', type: 'references', module: 'gamedesign' },
        { cle: 'declencheur', libelle: 'Déclenche', type: 'zone' },
        { cle: 'objets', libelle: 'Objets utilisés', type: 'references', module: 'objets' },
        { cle: 'decor', libelle: 'Décor', type: 'reference', module: 'decors' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' }
      ]
    },
    {
      id: 'audio', titre: 'Audio', icone: '♫', vue: 'liste', groupe: 'categorie',
      description: 'Musiques, ambiances, bruitages et voix, avec lecteur.',
      nomFiche: 'son',
      champs: [
        { cle: 'titre', libelle: 'Son', type: 'texte', requis: true },
        { cle: 'categorie', libelle: 'Catégorie', type: 'choix', options: ['Musique', 'Ambiance', 'Bruitage', 'Voix'] },
        { cle: 'fichier', libelle: 'Fichier son', type: 'audio' },
        { cle: 'description', libelle: 'Description', type: 'zone' },
        { cle: 'scenes', libelle: 'Scènes', type: 'references', module: 'scenario' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' }
      ]
    },
    {
      id: 'developpement', titre: 'Développement', icone: '⌘', vue: 'liste',
      description: 'Missions Claude Code : historique, GitHub et instructions à copier.',
      nomFiche: 'mission',
      champs: [
        { cle: 'titre', libelle: 'Mission', type: 'texte', requis: true },
        { cle: 'numero', libelle: 'Numéro', type: 'texte' },
        { cle: 'date', libelle: 'Date', type: 'date' },
        { cle: 'objectif', libelle: 'Objectif', type: 'zone' },
        { cle: 'branche', libelle: 'Branche', type: 'texte' },
        { cle: 'pr', libelle: 'Demande de fusion (lien)', type: 'lien' },
        { cle: 'instructions', libelle: 'Instructions pour Claude Code', type: 'copiable' },
        { cle: 'resultat', libelle: 'Résultat', type: 'zone' }
      ]
    },
    {
      id: 'tests', titre: 'Tests', icone: '✓', vue: 'liste', groupe: 'type',
      description: 'Anomalies, validations, captures et versions jouables.',
      nomFiche: 'test',
      champs: [
        { cle: 'titre', libelle: 'Test / anomalie', type: 'texte', requis: true },
        { cle: 'type', libelle: 'Type', type: 'choix', options: ['Anomalie', 'Test manuel', 'Tests automatiques', 'Version jouable'] },
        { cle: 'date', libelle: 'Date', type: 'date' },
        { cle: 'version', libelle: 'Version / commit', type: 'texte' },
        { cle: 'resultat', libelle: 'Résultat', type: 'zone' },
        { cle: 'captures', libelle: 'Captures', type: 'images' },
        { cle: 'liens', libelle: 'Liens', type: 'liens' }
      ]
    },
    {
      id: 'budget', titre: 'Budget', icone: '€', vue: 'budget',
      description: 'Abonnements, dépenses, prévisions, plafond et autorisations.',
      nomFiche: 'ligne de budget',
      champs: [
        { cle: 'titre', libelle: 'Intitulé', type: 'texte', requis: true },
        { cle: 'nature', libelle: 'Nature', type: 'choix', options: ['Abonnement existant', 'Dépense', 'Prévision', 'Option non autorisée'] },
        { cle: 'montant', libelle: 'Montant (€)', type: 'montant' },
        { cle: 'periodicite', libelle: 'Périodicité', type: 'choix', options: ['Mensuel', 'Annuel', 'Ponctuel'] },
        { cle: 'autorise', libelle: 'Autorisation de la directrice', type: 'choix', options: ['Non demandée', 'Demandée', 'Accordée', 'Refusée'] },
        { cle: 'date', libelle: 'Date', type: 'date' },
        { cle: 'notes', libelle: 'Notes', type: 'zone' }
      ]
    }
  ];

  function trouverModule(idModule) {
    for (var i = 0; i < MODULES.length; i++) {
      if (MODULES[i].id === idModule) return MODULES[i];
    }
    return null;
  }

  function cloner(valeur) {
    return JSON.parse(JSON.stringify(valeur));
  }

  // Identifiant unique, lisible, sans dépendance externe.
  var compteur = 0;
  function nouvelId(prefixe) {
    compteur += 1;
    return (prefixe || 'f') + '-' + Date.now().toString(36) + '-' + compteur.toString(36) +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function maintenant() {
    return new Date().toISOString();
  }

  // État vide : une collection (liste de fiches) par module, plus les réglages.
  function etatVide() {
    var etat = {
      version: VERSION_DONNEES,
      projet: { nom: '', genre: '', phase: '', dureeCible: '', moteur: '', resume: '' },
      reglages: { plafondAdditionnel: 0, theme: 'sombre', menuReplie: false },
      outils: [],
      collections: {}
    };
    MODULES.forEach(function (m) { etat.collections[m.id] = []; });
    return etat;
  }

  // Crée un état complet à partir de données initiales (ou vide).
  function creerEtat(donnees) {
    var etat = etatVide();
    if (!donnees) return etat;
    var source = cloner(donnees);
    if (source.projet) etat.projet = Object.assign(etat.projet, source.projet);
    if (source.reglages) etat.reglages = Object.assign(etat.reglages, source.reglages);
    if (Array.isArray(source.outils)) etat.outils = source.outils;
    MODULES.forEach(function (m) {
      var liste = (source.collections && source.collections[m.id]) || [];
      etat.collections[m.id] = liste.map(function (f) { return normaliserFiche(f); });
    });
    return etat;
  }

  function normaliserFiche(fiche) {
    var f = Object.assign({}, fiche);
    if (!f.id) f.id = nouvelId('f');
    if (!estStatutValide(f.statut)) f.statut = 'a_faire';
    if (!f.creeLe) f.creeLe = maintenant();
    if (!f.modifieLe) f.modifieLe = f.creeLe;
    if (typeof f.titre !== 'string') f.titre = f.titre == null ? '' : String(f.titre);
    return f;
  }

  function estStatutValide(statut) {
    return STATUTS.some(function (s) { return s.cle === statut; });
  }

  function libelleStatut(statut) {
    for (var i = 0; i < STATUTS.length; i++) if (STATUTS[i].cle === statut) return STATUTS[i].libelle;
    return statut;
  }

  function verifierModule(etat, idModule) {
    if (!trouverModule(idModule) || !etat.collections[idModule]) {
      throw new Error('Module inconnu : ' + idModule);
    }
  }

  function ajouterFiche(etat, idModule, fiche) {
    verifierModule(etat, idModule);
    var titre = fiche && typeof fiche.titre === 'string' ? fiche.titre.trim() : '';
    if (!titre) throw new Error('Le titre est obligatoire.');
    var nouvelle = normaliserFiche(Object.assign({}, fiche, { titre: titre, id: null }));
    nouvelle.creeLe = maintenant();
    nouvelle.modifieLe = nouvelle.creeLe;
    etat.collections[idModule].push(nouvelle);
    return nouvelle;
  }

  function trouverFiche(etat, idModule, idFiche) {
    verifierModule(etat, idModule);
    var liste = etat.collections[idModule];
    for (var i = 0; i < liste.length; i++) if (liste[i].id === idFiche) return liste[i];
    return null;
  }

  function modifierFiche(etat, idModule, idFiche, changements) {
    var fiche = trouverFiche(etat, idModule, idFiche);
    if (!fiche) throw new Error('Fiche introuvable.');
    var copie = Object.assign({}, changements);
    delete copie.id;
    delete copie.creeLe;
    if ('titre' in copie) {
      copie.titre = String(copie.titre || '').trim();
      if (!copie.titre) throw new Error('Le titre est obligatoire.');
    }
    if ('statut' in copie && !estStatutValide(copie.statut)) throw new Error('Statut inconnu.');
    Object.assign(fiche, copie);
    fiche.modifieLe = maintenant();
    return fiche;
  }

  // Supprime une fiche et retire toutes les références vers elle dans les autres modules.
  function supprimerFiche(etat, idModule, idFiche) {
    verifierModule(etat, idModule);
    var liste = etat.collections[idModule];
    var avant = liste.length;
    etat.collections[idModule] = liste.filter(function (f) { return f.id !== idFiche; });
    if (etat.collections[idModule].length === avant) return false;
    MODULES.forEach(function (m) {
      m.champs.forEach(function (c) {
        if (c.module !== idModule) return;
        etat.collections[m.id].forEach(function (f) {
          if (c.type === 'references' && Array.isArray(f[c.cle])) {
            f[c.cle] = f[c.cle].filter(function (id) { return id !== idFiche; });
          } else if (c.type === 'reference' && f[c.cle] === idFiche) {
            f[c.cle] = '';
          }
        });
      });
    });
    return true;
  }

  // Met le texte en minuscules et retire les accents, pour une recherche tolérante.
  function simplifier(texte) {
    return String(texte == null ? '' : texte)
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // Texte « cherchable » d'une fiche : tous les champs textuels (pas les images).
  function texteDeFiche(fiche) {
    var morceaux = [];
    Object.keys(fiche).forEach(function (cle) {
      var v = fiche[cle];
      if (typeof v === 'string' && v.indexOf('data:') !== 0) morceaux.push(v);
      else if (typeof v === 'number') morceaux.push(String(v));
    });
    return simplifier(morceaux.join(' '));
  }

  // Filtre une liste de fiches par texte (tous les mots doivent apparaître) et par statut.
  function filtrerFiches(fiches, criteres) {
    criteres = criteres || {};
    var mots = simplifier(criteres.texte || '').split(/\s+/).filter(Boolean);
    return fiches.filter(function (f) {
      if (criteres.statut && f.statut !== criteres.statut) return false;
      if (!mots.length) return true;
      var t = texteDeFiche(f);
      return mots.every(function (mot) { return t.indexOf(mot) !== -1; });
    });
  }

  // Recherche dans tous les modules à la fois.
  function rechercherPartout(etat, texte) {
    var resultats = [];
    if (!simplifier(texte).trim()) return resultats;
    MODULES.forEach(function (m) {
      filtrerFiches(etat.collections[m.id], { texte: texte }).forEach(function (f) {
        resultats.push({ module: m.id, fiche: f });
      });
    });
    return resultats;
  }

  // Trie par le champ « ordre » quand il existe ; sinon, garde l'ordre de création.
  function trierFiches(fiches) {
    return fiches.map(function (f, i) { return { f: f, i: i }; }).sort(function (a, b) {
      var oa = typeof a.f.ordre === 'number' ? a.f.ordre : Infinity;
      var ob = typeof b.f.ordre === 'number' ? b.f.ordre : Infinity;
      if (oa !== ob) return oa - ob;
      return a.i - b.i;
    }).map(function (x) { return x.f; });
  }

  // Regroupe des fiches selon la valeur d'un champ (ex. chapitre).
  // Les groupes gardent l'ordre de leur première apparition ; les fiches sont triées dans chaque groupe.
  function regrouper(fiches, cle) {
    var groupes = [];
    var index = {};
    fiches.forEach(function (f) {
      var nom = (f[cle] && String(f[cle]).trim()) || 'Sans ' + cle;
      if (!(nom in index)) { index[nom] = groupes.length; groupes.push({ nom: nom, fiches: [] }); }
      groupes[index[nom]].fiches.push(f);
    });
    groupes.forEach(function (g) { g.fiches = trierFiches(g.fiches); });
    return groupes;
  }

  // Compte les fiches par statut. Le pourcentage ne compte que ce qui est validé
  // par la directrice : un brouillon « à valider » n'est pas encore acquis.
  function avancement(fiches) {
    var compte = { a_faire: 0, en_cours: 0, a_valider: 0, valide: 0, total: fiches.length };
    fiches.forEach(function (f) { if (f.statut in compte) compte[f.statut] += 1; });
    compte.pourcentage = compte.total ? Math.round(compte.valide / compte.total * 100) : 0;
    return compte;
  }

  function avancementGlobal(etat) {
    var parModule = {};
    var toutes = [];
    MODULES.forEach(function (m) {
      if (m.id === 'tableau' || m.id === 'budget') return; // décisions et budget ne sont pas de la production
      parModule[m.id] = avancement(etat.collections[m.id]);
      toutes = toutes.concat(etat.collections[m.id]);
    });
    return { parModule: parModule, global: avancement(toutes) };
  }

  // Convertit un montant en coût mensuel.
  function coutMensuel(ligne) {
    var montant = Number(ligne.montant) || 0;
    if (ligne.periodicite === 'Annuel') return montant / 12;
    if (ligne.periodicite === 'Mensuel') return montant;
    return 0;
  }

  /*
   * Synthèse du budget.
   * - abonnementsMensuels : coût mensuel des abonnements existants.
   * - additionnelEngage : dépenses réelles (nature « Dépense ») déjà accordées.
   * - previsions : montants prévus, non engagés.
   * - depassement : vrai si les dépenses engagées dépassent le plafond.
   * - nonAutorisees : dépenses engagées sans autorisation accordée (anomalie).
   */
  function syntheseBudget(etat) {
    var lignes = etat.collections.budget || [];
    var plafond = Number(etat.reglages.plafondAdditionnel) || 0;
    var s = { plafond: plafond, abonnementsMensuels: 0, montantsInconnus: 0, additionnelEngage: 0, previsions: 0, nonAutorisees: [] };
    lignes.forEach(function (l) {
      var inconnu = l.montant === '' || l.montant == null;
      if (l.nature === 'Abonnement existant') {
        if (inconnu) s.montantsInconnus += 1;
        s.abonnementsMensuels += coutMensuel(l);
      } else if (l.nature === 'Dépense') {
        s.additionnelEngage += Number(l.montant) || 0;
        if (l.autorise !== 'Accordée') s.nonAutorisees.push(l);
      } else if (l.nature === 'Prévision') {
        s.previsions += Number(l.montant) || 0;
      }
    });
    s.abonnementsMensuels = Math.round(s.abonnementsMensuels * 100) / 100;
    s.additionnelEngage = Math.round(s.additionnelEngage * 100) / 100;
    s.previsions = Math.round(s.previsions * 100) / 100;
    s.reste = Math.round((plafond - s.additionnelEngage) * 100) / 100;
    s.depassement = s.additionnelEngage > plafond;
    return s;
  }

  /*
   * Dépendances des énigmes.
   * Une énigme est « bloquée » si l'un de ses prérequis n'est pas validé.
   * Détecte aussi les boucles (A nécessite B qui nécessite A), qui rendraient le jeu impossible.
   */
  function analyserDependances(etat) {
    var enigmes = etat.collections.gamedesign || [];
    var parId = {};
    enigmes.forEach(function (e) { parId[e.id] = e; });

    var bloquees = {};
    enigmes.forEach(function (e) {
      var manquants = (e.prerequis || []).filter(function (id) { return parId[id] && parId[id].statut !== 'valide'; });
      if (manquants.length) bloquees[e.id] = manquants;
    });

    // Recherche de boucles par parcours en profondeur.
    var boucles = [];
    var etatVisite = {}; // 1 = en cours, 2 = terminé
    function visiter(id, chemin) {
      if (etatVisite[id] === 2) return;
      if (etatVisite[id] === 1) {
        boucles.push(chemin.slice(chemin.indexOf(id)).concat(id));
        return;
      }
      etatVisite[id] = 1;
      ((parId[id] && parId[id].prerequis) || []).forEach(function (p) {
        if (parId[p]) visiter(p, chemin.concat(id));
      });
      etatVisite[id] = 2;
    }
    enigmes.forEach(function (e) { visiter(e.id, []); });

    // Ordre de résolution possible (tri topologique), si aucune boucle.
    var ordre = [];
    if (!boucles.length) {
      var fait = {};
      var placer = function (id) {
        if (fait[id]) return;
        fait[id] = true;
        (parId[id].prerequis || []).forEach(function (p) { if (parId[p]) placer(p); });
        ordre.push(id);
      };
      trierFiches(enigmes).forEach(function (e) { placer(e.id); });
    }
    return { bloquees: bloquees, boucles: boucles, ordre: ordre };
  }

  // Fiches d'autres modules qui pointent vers une fiche donnée (« utilisé dans »).
  function referencesEntrantes(etat, idModule, idFiche) {
    var res = [];
    MODULES.forEach(function (m) {
      m.champs.forEach(function (c) {
        if (c.module !== idModule) return;
        etat.collections[m.id].forEach(function (f) {
          var v = f[c.cle];
          if ((Array.isArray(v) && v.indexOf(idFiche) !== -1) || v === idFiche) {
            res.push({ module: m.id, champ: c.libelle, fiche: f });
          }
        });
      });
    });
    return res;
  }

  function exporterJSON(etat) {
    var copie = cloner(etat);
    copie.version = VERSION_DONNEES;
    copie.exporteLe = maintenant();
    copie.application = 'Studio Pixel — Manager';
    return JSON.stringify(copie, null, 2);
  }

  // Lit un export JSON. Lève une erreur claire si le fichier n'est pas valide.
  function importerJSON(texte) {
    var donnees;
    try { donnees = JSON.parse(texte); } catch (e) { throw new Error('Ce fichier n\'est pas un JSON valide.'); }
    if (!donnees || typeof donnees !== 'object' || !donnees.collections || typeof donnees.collections !== 'object') {
      throw new Error('Ce fichier ne ressemble pas à un export du Manager (collections manquantes).');
    }
    if (typeof donnees.version === 'number' && donnees.version > VERSION_DONNEES) {
      throw new Error('Ce fichier vient d\'une version plus récente du Manager.');
    }
    MODULES.forEach(function (m) {
      var liste = donnees.collections[m.id];
      if (liste != null && !Array.isArray(liste)) throw new Error('Module « ' + m.titre + ' » illisible dans ce fichier.');
    });
    return creerEtat(donnees);
  }

  function estCouleur(valeur) {
    return /^#[0-9a-fA-F]{6}$/.test(String(valeur || '').trim());
  }

  // Une adresse web sûre à afficher en lien (http, https ou mailto uniquement).
  function estLienSur(url) {
    return /^(https?:\/\/|mailto:)/i.test(String(url || '').trim());
  }

  // Une image ou un son : adresse web, ou fichier intégré (data:) du bon type.
  function estMediaSur(src, genre) {
    var s = String(src || '').trim();
    if (/^https?:\/\//i.test(s)) return true;
    if (genre === 'image') return /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s);
    if (genre === 'audio') return /^data:audio\/[a-z0-9.+-]+;base64,/i.test(s);
    return false;
  }

  var API = {
    VERSION_DONNEES: VERSION_DONNEES,
    STATUTS: STATUTS,
    MODULES: MODULES,
    trouverModule: trouverModule,
    nouvelId: nouvelId,
    etatVide: etatVide,
    creerEtat: creerEtat,
    ajouterFiche: ajouterFiche,
    trouverFiche: trouverFiche,
    modifierFiche: modifierFiche,
    supprimerFiche: supprimerFiche,
    simplifier: simplifier,
    filtrerFiches: filtrerFiches,
    rechercherPartout: rechercherPartout,
    trierFiches: trierFiches,
    regrouper: regrouper,
    avancement: avancement,
    avancementGlobal: avancementGlobal,
    coutMensuel: coutMensuel,
    syntheseBudget: syntheseBudget,
    analyserDependances: analyserDependances,
    referencesEntrantes: referencesEntrantes,
    exporterJSON: exporterJSON,
    importerJSON: importerJSON,
    libelleStatut: libelleStatut,
    estStatutValide: estStatutValide,
    estCouleur: estCouleur,
    estLienSur: estLienSur,
    estMediaSur: estMediaSur
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else racine.SPModele = API;
})(typeof window !== 'undefined' ? window : globalThis);
