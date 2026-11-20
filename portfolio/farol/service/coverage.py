"""Bounded evidence coverage, separate from retrieval similarity.

The guard distinguishes requested attributes from procedural language, and stated
numeric premises from requested counts. It reads values/entities from the cited
passage; no document IDs, answer keys, or question-specific exceptions are used.
This is a conservative lexical policy, not a general entailment model.
"""
import re
import unicodedata
from decimal import Decimal


def normalize(text):
    folded = ''.join(c for c in unicodedata.normalize('NFKD', text.lower())
                     if not unicodedata.combining(c))
    return re.sub(r'\b(?:wi-?fi|wireless|sem\s+fio)\b', 'semfio', folded)


GROUPS = (
    ('aprovacao', 'aprovacoes', 'aprova', 'aprovam', 'aprovar', 'aprovado', 'aprovada', 'aceite', 'aceites', 'aceitacao', 'aceitar', 'validar'),
    ('planejada', 'planejadas', 'planejado', 'planejados', 'programada', 'programadas', 'programado', 'programados'),
    ('custo', 'custos', 'custa', 'custam', 'custou', 'preco', 'precos', 'mensalidade', 'tarifa', 'orcamento', 'barato', 'barata', 'caro', 'cara'),
    ('pasta', 'pastas', 'diretorio', 'diretorios'),
    ('identificacao', 'identificador', 'identificadores', 'identificada', 'identificado', 'identificar'),
    ('restaurar', 'restaura', 'restaure', 'restauracao', 'restaurada', 'restaurado', 'recuperar', 'recuperacao', 'recuperada', 'recuperado'),
    ('teste', 'testes', 'testar', 'testa', 'verificacao', 'verificacoes', 'verificar', 'verifica', 'conferir', 'confira', 'confere'),
    ('falha', 'falhas', 'falhar', 'falhou', 'falham', 'caiu', 'cairam', 'cair', 'indisponivel', 'indisponiveis', 'indisponibilidade'),
    ('reserva', 'reposicao', 'sobressalente'),
    ('comunicacao', 'informe', 'informes', 'informa', 'informar', 'informado', 'informada', 'atualizacao', 'atualizacoes', 'atualizar', 'atualizada', 'atualizado', 'aviso', 'avisar', 'avisado', 'avisada', 'avisamos', 'notificar', 'notificacao'),
    ('contorno', 'alternativa', 'alternativas'),
    ('docente', 'professor', 'professora'),
    ('recebimento', 'reconhecimento', 'reconhecer'),
    ('retorno', 'retornar', 'retorna', 'volta', 'voltar', 'voltou', 'devolucao', 'devolvido', 'devolveu'),
    ('avaria', 'avariado', 'avariada', 'defeito', 'danificada', 'danificado', 'quebrado', 'quebrada'),
    ('fotografia', 'fotografar', 'fotografe', 'fotografada', 'fotografado'),
    ('tempo', 'duracao', 'periodo', 'prazo', 'prazos'),
    ('quantidade', 'total', 'quantos', 'quantas'),
    ('intervalo', 'frequencia', 'periodicidade'),
    ('link', 'links', 'circuito', 'circuitos'),
    ('informacao', 'informacoes', 'dado', 'dados'),
    ('confirmacao', 'confirmar', 'confirma', 'confirme', 'confirmou'),
    ('resolucao', 'resolver', 'solucionar', 'solucao', 'resolvido', 'resolvida'),
    ('pedido', 'pedir', 'pedida', 'solicitar', 'solicitacao'),
    ('inicio', 'iniciar', 'comeca', 'comecar', 'acionam'),
    ('registro', 'registros', 'registrar', 'registre', 'registra', 'anotar', 'anote', 'anoto'),
    ('fechamento', 'encerrar', 'encerramento', 'encerra', 'fechar'),
    ('compartilhamento', 'espelhamento', 'transmissao'),
    ('emprestimo', 'emprestimos', 'emprestar'),
    ('turno', 'plantao'),
    ('responsabilidade', 'responsavel'),
    ('papel', 'papeis', 'funcao', 'funcoes'),
)
ALIASES = {term: group[0] for group in GROUPS for term in group}
VERBS = {term[:-2]: group[0] for group in GROUPS for term in group if term.endswith(('ar', 'er', 'ir'))}
# Operational infinitives are grammatical boundaries, even when they have no
# synonym group. Their conjugations must not become requested field modifiers.
PROCEDURAL_VERBS = ('aplicar', 'marcar', 'usar', 'tomar', 'continuar', 'parar', 'manter',
             'sinalizar', 'classificar', 'atribuir', 'publicar', 'enviar', 'emitir',
             'proteger', 'evitar', 'ocultar', 'selecionar', 'colocar', 'transmitir',
             'permitir', 'autorizar', 'incluir', 'obter', 'seguir', 'aguardar',
             'liberar', 'esperar', 'repetir', 'operar', 'rotular', 'definir')
INFLECTIONS = {'o', 'a', 'e', 'as', 'es', 'am', 'em', 'ou', 'eu', 'iu', 'ava', 'avam', 'ia', 'iam',
               'ando', 'endo', 'indo', 'ado', 'ada', 'ados', 'adas', 'ido', 'ida', 'idos', 'idas', 'aram', 'eram', 'iram'}
FUNCTION = set('a o os as que do da das dos de um uma em e na no nos nas para por pelo pela ao aos com qual quais quanto quando quem como se ou me eu posso podemos deve sao mais meu minha fica sobre la lo las los eh precisa precisam preciso pode podem devo devemos devem ser estar esta estao estou foi sera ainda ja mesmo esse essa isso ele ela eles elas antes depois durante ate apos so tem tenho teria vai vao faz fazer faco permite permitido permitida necessario necessaria exato exata completo completa'.split())
STOP = FUNCTION
NUMBERS = dict(zip('zero um uma dois duas tres quatro cinco seis sete oito nove dez onze doze treze quatorze catorze quinze dezesseis dezessete dezoito dezenove vinte trinta quarenta cinquenta sessenta'.split(),
                   (0,1,1,2,2,3,4,5,6,7,8,9,10,11,12,13,14,14,15,16,17,18,19,20,30,40,50,60)))
NUMBERS.update({'unico':1, 'unica':1})


def canonical(word):
    if word in ALIASES:
        word = ALIASES[word]
    else:
        word = next((value for stem, value in VERBS.items()
                     if word.startswith(stem) and word[len(stem):] in INFLECTIONS), word)
    if len(word) > 4 and word.endswith('s') and not word.endswith(('is', 'us', 'ss')):
        word = word[:-1]
    return word


def words(text):
    return [canonical(w) for w in re.findall(r'[a-z0-9]+', normalize(text))
            if w not in STOP and len(w) > 1]


def near(a, b):
    """One typo only on longer words; IDs and numbers are never fuzzed."""
    if a == b:
        return True
    if min(len(a), len(b)) < 6 or abs(len(a)-len(b)) > 1 or not (a.isalpha() and b.isalpha()):
        return False
    if len(a) == len(b):
        differences = [i for i in range(len(a)) if a[i] != b[i]]
        return len(differences) == 1 or (len(differences) == 2
            and differences[1] == differences[0]+1
            and a[differences[0]] == b[differences[1]]
            and a[differences[1]] == b[differences[0]])
    shorter, longer = sorted((a,b), key=len)
    return any(longer[:i]+longer[i+1:] == shorter for i in range(len(longer)))


def covered(term, terms):
    return term in terms or sum(near(term, other) for other in terms) == 1


GENERIC_FOCUS = {'informacao', 'orientacao', 'procedimento', 'equipamento', 'momento', 'acao', 'criterio', 'registro', 'papel', 'passo', 'contorno', 'opcao', 'forma', 'documento', 'parte'}
PREPOSITIONS = {'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'entre', 'antes', 'depois', 'apos', 'ate', 'quando', 'que', 'e'}
MODAL_ADJECTIVES = {'permitido', 'permitida', 'necessario', 'necessaria', 'obrigatorio', 'obrigatoria', 'exato', 'exata', 'completo', 'completa'}
FINITE_VERBS = set('entra entram fica ficam tem temos recebe recebem uso usam confiro anoto aparece continuam continuar permite permitem preciso precisam deve devem devo posso podemos vai vao fazem faz dura vale leva demora termina terminao ocorre funciona registro registrar pego encontro guardo guardamos aprova aprovam mantem mantemos'.split())
TIME = re.compile(r'\b(?:segundos?|minutos?|horas?|dias?|noites?|turnos?|anos?|meses?)\b|\b\d+h\b')
WEEKDAY = re.compile(r'\b(?:(?:segunda|terca|quarta|quinta|sexta)-feira|sabado|domingo)s?\b')
CLOCK = re.compile(r'\b(?:[01]?\d|2[0-3])(?:h(?:[0-5]\d)?|:[0-5]\d)\b')
CONDITIONAL_DURATION = re.compile(r'\benquanto\b|\bate (?:que|o fim|a conclusao|o termino)\b')
PROCEDURAL_CARE = {'cuidado', 'precaucao', 'precaucoe', 'recomendacao', 'instrucao', 'conduta'}
SCALE = {'segundo':1, 'minuto':60, 'hora':3600, 'dia':86400, 'semana':604800}


def quantities(text):
    """Typed premises, with explicit bounds. Narrative articles are not counts."""
    raw = list(re.finditer(r'-?\d+(?:[.,]\d+)?|[a-z][a-z0-9]*|%', normalize(text)))
    found = []
    for i, match in enumerate(raw[:-1]):
        term = match.group()
        number = Decimal(term.replace(',', '.')) if re.fullmatch(r'-?\d+(?:[.,]\d+)?', term) else NUMBERS.get(term)
        if number is None or term in {'um', 'uma'}:
            continue
        position = i + 1
        while position < len(raw)-1 and raw[position].group() in {'ou', 'mais', 'menos', 'ultimos', 'consecutivas', 'consecutivos'}:
            position += 1
        unit = canonical(raw[position].group())
        if unit in {'vez', 'veze', 'teste'} and 'falha' in words(text):
            unit = 'falha'
        if unit in FUNCTION or unit in GENERIC_FOCUS:
            continue
        before = normalize(text)[:match.start()]
        between = normalize(text)[match.end():raw[position].start()]
        after = normalize(text)[raw[position].end():]
        bound = 'eq'
        if re.search(r'(?:menos de|abaixo de|(?<!<)<)\s*$', before):
            bound = 'lt'
        elif re.search(r'(?:mais de|acima de|(?<!>)>)\s*$', before):
            bound = 'gt'
        elif re.search(r'(?:ate|no maximo|<=|≤)\s*$', before) or re.match(r'\s+ou menos\b', after) or 'menos' in between:
            bound = 'le'
        elif re.search(r'(?:ao menos|no minimo|>=|≥)\s*$', before) or re.match(r'\s+ou mais\b', after) or 'mais' in between:
            bound = 'ge'
        found.append((number, unit, bound))
    return found


def numeric_premises_supported(query, text):
    evidence = quantities(text)
    def within(a, query_bound, b, evidence_bound):
        if query_bound == 'eq':
            return {'eq': a == b, 'le': a <= b, 'lt': a < b, 'ge': a >= b, 'gt': a > b}[evidence_bound]
        if query_bound in {'le', 'lt'} and evidence_bound in {'le', 'lt'}:
            return a < b or (a == b and (query_bound == 'lt' or evidence_bound == 'le'))
        if query_bound in {'ge', 'gt'} and evidence_bound in {'ge', 'gt'}:
            return a > b or (a == b and (query_bound == 'gt' or evidence_bound == 'ge'))
        return False
    for number, unit, query_bound in quantities(query):
        matches = []
        for value, other, bound in evidence:
            if unit == other:
                matches.append((number, value, bound))
            elif unit in SCALE and other in SCALE:
                matches.append((number*SCALE[unit], value*SCALE[other], bound))
        if not any(within(a, query_bound, b, bound) for a, b, bound in matches):
            return False
    return True


def entities_supported(query, context):
    terms = set(words(context))
    folded = normalize(context)
    # Literal labels and calendar premises are source data, not vocabulary
    # synonyms. A different quoted state or weekday cannot use this instruction.
    for label in re.findall(r'["“]([^"”]+)["”]|\x27([^\x27]+)\x27', query):
        literal = normalize(next(part for part in label if part))
        if literal not in folded:
            return False
    if any(day.group() not in folded for day in WEEKDAY.finditer(normalize(query))):
        return False
    # Labels and literal alphanumeric IDs survive sentence-initial capitalization.
    for entity in re.findall(r'\bwan\s+([a-z0-9-]+)', normalize(query)):
        if entity not in FUNCTION | {'principal', 'reserva'} and not covered(canonical(entity), terms):
            return False
    for entity in re.findall(r'\b(?i:sala|bloco|modelo)\s+([A-ZÀ-Ý][\w-]*|\d[\w-]*)', query):
        if not covered(canonical(normalize(entity)), terms):
            return False
    identifier_pattern = r'\b(?:[A-Za-z]+-\d+[\w-]*|[A-Z]{1,6}\s*\d+)\b'
    known_ids = {re.sub(r'\s+', '', normalize(value)) for value in re.findall(identifier_pattern, context)}
    for identifier in re.findall(identifier_pattern, query):
        if re.sub(r'\s+', '', normalize(identifier)) not in known_ids:
            return False
    for match in re.finditer(r'\b[^\W\d_]\w*(?:-\w+)*\b', query):
        name = match.group()
        term = normalize(name)
        at_sentence_start = not query[:match.start()].strip() or bool(re.search(r'[.!?;:]\s*$', query[:match.start()]))
        if at_sentence_start or not name[0].isupper() or term in FUNCTION | {'onde', 'quantos', 'quantas'}:
            continue
        if '-' in term and term in folded:
            continue
        if not covered(canonical(term), terms):
            return False
    return True


def is_verb(word, *, procedural=True):
    stems = set(VERBS)
    if procedural:
        stems.update(verb[:-2] for verb in PROCEDURAL_VERBS)
    return word in FINITE_VERBS or any(word == stem+ending for stem in stems for ending in INFLECTIONS | {'ar', 'er', 'ir'})


def requested_fields(query):
    """Extract noun heads/qualifiers; finite verbs and particles end a field."""
    # An unaccented conjunction introduces a second request; the copula "é" does not.
    first = re.search(r'\b(?:qual|quais)\b', query, flags=re.I)
    if first:
        query = query[:first.start()] + re.sub(r'\be\s+(o|a|os|as)\s+', r'e qual \1 ', query[first.start():], flags=re.I)
    # Retain the grammatical difference lost by accent folding: "é" is a
    # copula, while "e" may coordinate another requested field.
    q = normalize(re.sub(r'\bé\b', 'esta', query, flags=re.I))
    pattern = r'\b(?:qual|quais|que|informe|diga|mostre|informar|saber)\s+(?:(?:e|esta|sao|foi|o|a|os|as|seu|sua|'+'|'.join(NUMBERS)+r')\s+)*([a-z0-9-]+)'
    for match in re.finditer(pattern, q):
        keyword = match.group().split()[0]
        if keyword in {'informe', 'diga', 'mostre', 'informar', 'saber'}:
            previous = re.findall(r'[a-z]+', q[:match.start()])
            # A nominal "o informe periódico" is the object of a procedure,
            # not an imperative asking for a field named "periódico".
            if previous and previous[-1] in {'o', 'a', 'os', 'as', 'um', 'uma', 'do', 'da', 'dos', 'das'}:
                continue
        if match.group().split()[0] == 'que':
            prefix = q[:match.start()].rstrip()
            previous = re.findall(r'[a-z]+', prefix)
            # "O que [subject] deve fazer" is a procedural clause, while
            # "de que documento" asks for a noun. Relative "depois que..."
            # and "o equipamento que..." do not introduce requested fields.
            if prefix and not re.search(r'[.,;:!?]$', prefix) and (not previous or previous[-1] not in {'de', 'em', 'com'}):
                continue
        head = match.group(1)
        # After an interrogative, a conjugated verb may instead be a noun
        # (e.g. "marca"). Extra procedural verbs only bound the following tail.
        if head in FUNCTION or is_verb(head, procedural=False):
            continue
        tail = q[match.end():]
        modifiers = []
        end = 0
        coordinated = None
        for token in re.finditer(r'[a-z0-9-]+', tail):
            part = token.group()
            if part == 'e':
                following = re.match(r'\s+(?:(?:o|a|os|as)\s+)?([a-z0-9-]+)', tail[token.end():])
                if following and following.group(1) not in FUNCTION and not is_verb(following.group(1)):
                    coordinated = tail[token.end():]
            if re.search(r'[?.!;:]', tail[:token.start()]) or part in PREPOSITIONS or is_verb(part):
                break
            if part in FUNCTION and part not in MODAL_ADJECTIVES | {'mais', 'menos'}:
                break
            end = token.end()
            if part in FUNCTION or part in MODAL_ADJECTIVES or (canonical(head) == 'tempo' and part in {'maximo', 'minimo', 'inicial'}):
                continue
            modifiers.append(canonical(part))
        qualifier = re.match(r'\s+d(?:e|o|a|os|as)\s+([a-z0-9-]+)', tail[end:])
        yield canonical(head), modifiers, canonical(qualifier.group(1)) if qualifier else None
        if coordinated:
            yield from requested_fields('qual '+coordinated)


def temporal_sentences(text):
    return [sentence for sentence in re.split(r'[.!?;]', text)
            if TIME.search(sentence) or CONDITIONAL_DURATION.search(sentence)]


def state_sentences(text):
    """A quoted label is evidence of state only when it is actually assigned."""
    assignment = re.compile(r'\b(?:marque|marcar|classifique|classificar|rotule|rotular|sinalize|sinalizar|defina|definir|coloque|colocar)\b[^.!?;]{0,100}\b(?:como|em|estado|status)\s+["“\']')
    explicit = re.compile(r'\b(?:estado|status|situacao)\b[^.!?;]{0,70}(?:\be\b|:|=)\s+["“\']')
    return [sentence for sentence in re.split(r'[.!?;]', text) if assignment.search(sentence) or explicit.search(sentence)]


def fields_supported(query, text, context):
    terms = set(words(text))
    context_terms = set(words(context))
    sentences = [set(words(sentence)) for sentence in re.split(r'[.!?;]', text)]
    # A procedure does not identify a particular past occurrence. Its generic
    # instruction to record a cause is not the cause of yesterday's incident.
    if re.search(r'\b(?:foi|foram|teve|tiveram)\b', normalize(query)):
        for when in re.findall(r'\b(?:ontem|hoje|anteontem|anterior|passad[oa])\b', normalize(query)):
            if not covered(canonical(when), terms):
                return False
    for field, modifiers, qualifier in requested_fields(query):
        if field in GENERIC_FOCUS:
            continue
        derived = None
        if field == 'tempo':
            if not temporal_sentences(text):
                return False
        elif field in PROCEDURAL_CARE:
            instructions = [sentence for sentence in re.split(r'[.!?;]', text)
                            if re.search(r'\b(?:sem|nao|nunca|somente|apenas|evite|deve|precisa|obrigatorio)\b', sentence)]
            if not instructions:
                return False
            subject = re.search(r'\bcom\s+(?:(?:o|a|os|as)\s+)?([a-z0-9-]+)', normalize(query))
            if subject and not any(covered(canonical(subject.group(1)), set(words(sentence))) for sentence in instructions):
                return False
        elif field in {'estado', 'status', 'situacao'}:
            derived = state_sentences(text)
            if not derived:
                return False
        elif field == 'dia':
            if not WEEKDAY.search(text) and not re.search(r'\b\d{1,2}/\d{1,2}/\d{4}\b', text):
                return False
        elif field in {'horario', 'hora'}:
            if not covered(field, terms) and not CLOCK.search(text):
                return False
        elif field == 'intervalo':
            if not re.search(r'\ba cada\b|\bpor (?:noite|dia|semana|mes|turno)\b|\bintervalo\b|\bfrequencia\b', text):
                return False
        elif field == 'percentual':
            if '%' not in text:
                return False
        elif field == 'identificacao':
            if not terms & {'identificacao', 'numero', 'codigo', 'patrimonio', 'lote'}:
                return False
        elif field == 'prioridade':
            if not re.search(r'\bp\d+\b|\bprioridade\b', text):
                return False
        elif field in {'local', 'localizacao', 'lugar'}:
            if not re.search(r'\b(?:no|na|ao|em|numa)\s+\S+', text):
                return False
        elif not covered(field, terms):
            return False
        if any(not covered(modifier, terms) for modifier in modifiers):
            return False
        if qualifier and qualifier not in {'execucao', 'estabilidade'}:
            if not covered(qualifier, context_terms):
                return False
            if derived and not any(covered(qualifier, set(words(sentence))) for sentence in derived):
                return False
            if field in {'nome', 'numero', 'codigo', 'marca'} or modifiers:
                if not any(all(covered(part, sentence) for part in [field, *modifiers, qualifier]) for sentence in sentences):
                    return False
    # A copular actor question asks for a role/identity, not merely a matching device.
    for subject in re.findall(r'\bquem\s+e\s+(?:o|a)\s+([a-z0-9-]+)', normalize(query)):
        if not covered(canonical(subject), terms):
            return False
    # These interrogatives carry a noun after a verb: warranty expiry differs from
    # the two-minute print-test wait even when both mention the same printer.
    for subject in re.findall(r'\bquando\s+\w+\s+(?:o|a)\s+([a-z0-9-]+)', normalize(query)):
        if not covered(canonical(subject), context_terms):
            return False
    return True


def counts_and_time_supported(query, text, context):
    q = normalize(query)
    terms = set(words(text))
    for unit in re.findall(r'\bquant[oa]s\s+([a-z0-9-]+)', q):
        unit = canonical(unit)
        raw = re.findall(r'[a-z0-9]+', text)
        count_words = set(NUMBERS) - {'um', 'uma'}
        if re.search(r'\b(?:ha|existem?|possui|total|estoque)\b', text):
            count_words |= {'um', 'uma'}
        if not any((raw[i].isdigit() or raw[i] in count_words)
                   and any(covered(unit, {canonical(w)}) for w in raw[i+1:i+4]) for i in range(len(raw))):
            return False
    for field in re.findall(r'\bquanto\s+([a-z0-9-]+)', q):
        field = canonical(field)
        if field not in {'tempo', 'em'} and not covered(field, terms):
            return False
    if re.search(r'\bquanto\s+tempo\b', q) and not temporal_sentences(text):
        return False
    temporal = re.search(r'\b(?:tempo|prazo|intervalo|duracao|periodo)\b', q)
    if temporal:
        actions = re.findall(r'\bpara\s+([a-z]+(?:ar|er|ir))\b', q[temporal.end():])
        timed = [set(words(sentence)) for sentence in temporal_sentences(text)]
        if any(not any(covered(canonical(action), sentence) for sentence in timed) for action in actions):
            return False
        continued = re.search(r'\b(?:continuar|manter|repetir|publicar|emitir|operar)\s+(?:o|a|os|as)\s+([a-z0-9-]+)', q[temporal.end():])
        if continued and not any(covered(canonical(continued.group(1)), sentence) for sentence in timed):
            return False
    for match in re.finditer(r'\bquanto\s+tempo\s+(?:(?:dura|vale|tem|demora|leva)\s+(?:(?:o|a|de)\s+)?|(?:de|do|da)\s+)([a-z0-9-]+)', q):
        subject = canonical(match.group(1))
        if subject not in FUNCTION | {'espero', 'entre'} and not covered(subject, set(words(context))):
            return False
    return True


def requirements(query, passage):
    text = normalize(passage.text)
    context = f'{passage.title} {passage.heading} {passage.text}'
    return (numeric_premises_supported(query, text+' '+normalize(passage.heading))
            and entities_supported(query, context)
            and fields_supported(query, text, context)
            and counts_and_time_supported(query, text, context))


def supported(query, passage, score):
    tokens = set(words(query))
    terms = set(words(f'{passage.title} {passage.heading} {passage.text}'))
    if temporal_sentences(normalize(passage.text)):
        terms.add('tempo')
    if not tokens or score < .10 or not requirements(query, passage):
        return False
    matched = sum(covered(token, terms) for token in tokens)
    return matched >= 2 and matched / len(tokens) >= .30
