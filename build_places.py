# Genera data/places.json da data/osm.json (OpenStreetMap) + luoghi storici curati a mano.
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
osm = json.load(open(os.path.join(HERE, 'data', 'osm.json'), encoding='utf8'))

CAT = {'restaurant': 'ristoranti', 'bar': 'aperitivi', 'pub': 'aperitivi', 'biergarten': 'aperitivi',
       'cafe': 'caffe', 'fast_food': 'street', 'ice_cream': 'gelato'}
CUISINE = {'pizza': 'Pizza', 'italian': 'Italiana', 'regional': 'Tipica marchigiana', 'seafood': 'Pesce',
           'fish': 'Pesce', 'sushi': 'Sushi', 'japanese': 'Giapponese', 'chinese': 'Cinese', 'burger': 'Burger',
           'kebab': 'Kebab', 'piadina': 'Piadina', 'sandwich': 'Panini', 'coffee_shop': 'Caffetteria',
           'ice_cream': 'Gelato', 'mexican': 'Messicana', 'indian': 'Indiana', 'steak_house': 'Carne',
           'grill': 'Griglia', 'vegan': 'Vegana', 'vegetarian': 'Vegetariana', 'friture': 'Fritto',
           'pasta': 'Pasta', 'cake': 'Dolci', 'pastry': 'Pasticceria', 'chicken': 'Pollo', 'asian': 'Asiatica',
           'greek': 'Greca', 'wine': 'Vini', 'beer': 'Birre', 'cocktail': 'Cocktail'}

places = []
for e in osm['elements']:
    t = e['tags']
    a = t.get('amenity')
    if a not in CAT or not t.get('name'):
        continue
    c = e.get('center', e)
    cu = [CUISINE.get(x.strip().lower(), x.strip().replace('_', ' ').capitalize()) for x in t.get('cuisine', '').split(';') if x.strip()]
    addr = ' '.join(filter(None, [t.get('addr:street'), t.get('addr:housenumber')]))
    places.append({
        'id': f"{e['type'][0]}{e['id']}", 'name': t['name'], 'cat': CAT[a], 'lat': round(c['lat'], 6), 'lng': round(c['lon'], 6),
        'tags': cu[:3], 'addr': addr, 'hours': t.get('opening_hours', ''), 'phone': t.get('phone') or t.get('contact:phone', ''),
        'web': t.get('website') or t.get('contact:website', ''), 'outdoor': t.get('outdoor_seating') == 'yes',
    })

STORIA = [
    ('Rocca Malatestiana', 43.84736, 13.01508, 'storia', 'Fortezza del XV secolo voluta da Sigismondo Pandolfo Malatesta, con il possente mastio affacciato verso il mare. Oggi ospita eventi e mostre estive.', '🏰'),
    ("Arco d'Augusto", 43.84308, 13.01450, 'storia', "Porta romana del 9 d.C., simbolo della città: l'ingresso monumentale della Via Flaminia nell'antica Fanum Fortunae.", '🏛️'),
    ('Il Pincio', 43.84291, 13.01386, 'storia', "Giardino panoramico sul Bastione Nuti, a due passi dall'Arco d'Augusto e Porta Maggiore: perfetto per un incontro al tramonto.", '🌳'),
    ('Mura Augustee', 43.84449, 13.01308, 'storia', 'Il tratto di mura romane meglio conservato delle Marche, con torri e camminamento lungo Via Mura Augustee.', '🧱'),
    ('Corte Malatestiana', 43.84426, 13.01796, 'storia', "Cortile rinascimentale del Palazzo Malatestiano: d'estate si trasforma in teatro all'aperto. Sede del Museo Civico.", '🏯'),
    ('Museo Archeologico e Pinacoteca', 43.84435, 13.01831, 'storia', 'Nel Palazzo Malatestiano: reperti di Fanum Fortunae, mosaici romani e opere del Guercino e di Guido Reni.', '🖼️'),
    ('Fontana della Fortuna', 43.84324, 13.01755, 'storia', 'In Piazza XX Settembre, la dea Fortuna che dà il nome romano alla città. Il punto d\'incontro classico dei fanesi.', '⛲'),
    ('Piazza XX Settembre', 43.84348, 13.01769, 'storia', 'Il salotto di Fano, tra il Palazzo del Podestà, il Teatro e la fontana. Cuore della passeggiata serale.', '📍'),
    ('Teatro della Fortuna', 43.84396, 13.01752, 'storia', "Teatro ottocentesco all'italiana, ricostruito dopo la guerra, dentro il medievale Palazzo della Ragione.", '🎭'),
    ('Palazzo del Podestà', 43.84386, 13.01766, 'storia', 'Detto anche Palazzo della Ragione (1299), con la torre civica che domina la piazza.', '🏛️'),
    ('Basilica Vitruviana', 43.84462, 13.01713, 'storia', "Il sito della basilica progettata da Vitruvio, l'unica opera che l'architetto romano descrive di aver costruito.", '🏺'),
    ('Anfiteatro Romano', 43.84549, 13.01416, 'storia', "Resti dell'anfiteatro dell'antica Fanum Fortunae, vicino alle mura.", '🏟️'),
    ('Cattedrale di Santa Maria Assunta', 43.84347, 13.01561, 'storia', 'Duomo di origine romanica con la cappella Nolfi affrescata dal Domenichino.', '⛪'),
    ('Basilica di San Paterniano', 43.84130, 13.02054, 'storia', 'Dedicata al patrono di Fano, con chiostro rinascimentale. Il 10 luglio è festa grande in città.', '⛪'),
    ('Chiesa di San Pietro in Valle', 43.84399, 13.01987, 'storia', 'Uno dei più bei barocchi delle Marche: interni dorati e stucchi spettacolari.', '⛪'),
    ('Arche Malatestiane (San Francesco)', 43.84323, 13.01934, 'storia', 'Il portico della chiesa di San Francesco senza tetto, con le tombe monumentali dei Malatesta.', '🕯️'),
    ('Chiesa di Santa Maria Nuova', 43.84224, 13.01695, 'storia', 'Custodisce opere del Perugino e di Giovanni Santi, padre di Raffaello.', '⛪'),
    ('Porta Maggiore', 43.84246, 13.01392, 'storia', 'Porta cinquecentesca accanto all\'Arco d\'Augusto, lungo la cinta muraria.', '🚪'),
    ('Bastione del Sangallo', 43.84259, 13.02350, 'storia', 'Bastione cinquecentesco progettato da Antonio da Sangallo il Giovane.', '🛡️'),
    ('Porta della Mandria', 43.84492, 13.01292, 'storia', 'Antica porta nelle mura, oggi passaggio verso il Lido.', '🚪'),
    ('Faro di Fano', 43.85103, 13.01542, 'mare', 'Il faro del porto: passeggiata sul molo e vista sul mare, specialmente al tramonto.', '🗼'),
    ('Spiaggia del Lido', 43.85187, 13.01244, 'mare', 'Spiaggia di sabbia a nord del porto, con stabilimenti, chalet e locali per l\'aperitivo.', '🏖️'),
    ('Spiaggia della Sassonia', 43.84621, 13.02295, 'mare', 'Spiaggia di ghiaia a sud del porto, lungomare pieno di bar e ristoranti di pesce.', '🌊'),
    ('Santa Maria a Mare', 43.85156, 13.00784, 'storia', 'Ruderi di una chiesa medievale vicino alla costa, a nord del Lido.', '🪨'),
]
for i, (n, la, lo, cat, d, ico) in enumerate(STORIA):
    places.append({'id': f'h{i}', 'name': n, 'cat': cat, 'lat': la, 'lng': lo, 'desc': d, 'icon': ico, 'tags': [], 'featured': True})

json.dump(places, open(os.path.join(HERE, 'data', 'places.json'), 'w', encoding='utf8'), ensure_ascii=False)
from collections import Counter
print(len(places), Counter(p['cat'] for p in places))
