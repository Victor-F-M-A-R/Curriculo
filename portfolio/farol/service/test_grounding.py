import json
import unittest
from unittest.mock import patch

from search import DATA, Index, answer


def manual(text, ident='TEST-NEW'):
    return [{'id':ident, 'title':'Inventário do laboratório Aurora', 'owner':'Equipe de teste',
             'revision':'2026-11-20', 'sections':[{'id':'inventory', 'heading':'Ficha técnica', 'text':text}]}]


class GroundingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = Index()

    def test_predeclared_scenarios_include_missing_fields_and_complete_answers(self):
        cases = json.loads((DATA/'qa-cases.json').read_text(encoding='utf-8-sig'))
        for case in cases:
            with self.subTest(case=case['id']):
                result = answer(self.index, case['query'], use_model=False)
                ids = [row['id'] for row in result['evidence']]
                self.assertEqual(ids, [case['expected']] if case['expected'] else [])
                self.assertEqual(result['state'], 'answered' if case['expected'] else 'abstained')
                for fact in case.get('facts', []):
                    self.assertIn(fact, result['answer'])

    def test_fields_are_not_blacklisted_and_new_names_values_are_read_from_data(self):
        for count, brand, days, speed in [(7,'Acácia',90,420),(28,'Bambu',365,175)]:
            text = (f'Existem {count} Chromebooks no balcão do laboratório Aurora. '
                    f'A marca do projetor é {brand}. A garantia da impressora dura {days} dias. '
                    f'A velocidade contratada da WAN Nogueira é {speed} Mbps. '
                    'A largura da mesa é 73 centímetros. O peso do tablet é 610 gramas.')
            index = Index(manual(text))
            for query, fact in [
                ('Quantos Chromebooks existem no balcão do laboratório Aurora?',str(count)),
                ('Qual é a marca do projetor?',brand),
                ('Quanto tempo dura a garantia da impressora?',str(days)),
                ('Qual a velocidade contratada da WAN Nogueira?',str(speed)),
                ('Qual a largura da mesa?', '73'),
                ('Qual o peso do tablet?', '610'),
                ('Qual a velocidae contratada da WAN Nogueira?',str(speed)),
            ]:
                with self.subTest(query=query, count=count):
                    result = answer(index, query, use_model=False)
                    self.assertEqual(result['state'], 'answered')
                    self.assertIn(fact, result['answer'])
                    self.assertEqual(result['evidence'][0]['id'], 'TEST-NEW#inventory')
            for query in ['Qual a cor da mesa?', 'Qual o número de série do tablet?',
                          'Qual a marca do projetor e o telefone do fabricante?',
                          'Qual a velocidade contratada da WAN Jacarandá?']:
                with self.subTest(query=query):
                    self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')

    def test_wrong_document_scope_never_borrows_another_manual(self):
        result = answer(self.index, 'Onde fica o cabo HDMI reserva?', document='RB-02', use_model=False)
        self.assertEqual(result['state'], 'abstained')
        self.assertEqual(result['evidence'], [])

    def test_revealed_independent_cases_are_now_regressions(self):
        # First blind run: 33/41. These cases were disclosed after that run and
        # cannot be reported as an independent estimate after subsequent fixes.
        cases = json.loads((DATA/'revealed-holdout-cases.json').read_text(encoding='utf-8-sig'))
        for case in cases:
            with self.subTest(case=case['id']):
                result = answer(self.index, case['query'], use_model=False)
                self.assertEqual([row['id'] for row in result['evidence']],
                                 [case['expected']] if case['expected'] else [])
                for fact in case.get('facts', []):
                    self.assertIn(fact, result['answer'])

    def test_second_blind_round_is_preserved_as_revealed_regression(self):
        # Independent result before disclosure: 19/30 (6/17 positive, 13/13 negative).
        # These now-revealed questions cannot measure subsequent generalization.
        cases = json.loads((DATA/'revealed-second-holdout-cases.json').read_text(encoding='utf-8-sig'))
        for case in cases:
            with self.subTest(case=case['id']):
                result = answer(self.index, case['query'], use_model=False)
                self.assertEqual([row['id'] for row in result['evidence']],
                                 [case['expected']] if case['expected'] else [])
                for fact in case.get('facts', []):
                    self.assertIn(fact, result['answer'])

    def test_numeric_conditions_are_typed_ranges_not_exact_literal_matches(self):
        from coverage import numeric_premises_supported
        for limit in (8, 27, 63):
            with self.subTest(limit=limit):
                upper = f'Quando o sensor indicar carga em {limit}% ou menos, registre o valor e avise a manutenção.'
                lower = f'Quando o sensor indicar tensão de {limit} volts ou mais, registre o valor e avise a manutenção.'
                self.assertTrue(numeric_premises_supported(f'Carga em {limit-3}%: o que devo registrar?', upper))
                self.assertTrue(numeric_premises_supported(f'Carga em {limit}%: o que devo registrar?', upper))
                self.assertFalse(numeric_premises_supported(f'Carga em {limit+3}%: o que devo registrar?', upper))
                self.assertFalse(numeric_premises_supported(f'Acima de {limit-3}%: o que devo registrar?', upper))
                self.assertTrue(numeric_premises_supported(f'Tensão de {limit+3} volts: o que devo registrar?', lower))
                self.assertFalse(numeric_premises_supported(f'Tensão de {limit-3} volts: o que devo registrar?', lower))
                self.assertFalse(numeric_premises_supported(f'Tensão de {limit+3} amperes: o que devo registrar?', lower))
        self.assertTrue(numeric_premises_supported('Carga em 7,5%: o que registro?', 'Se a carga ficar abaixo de 8%, registre o valor.'))
        self.assertFalse(numeric_premises_supported('Carga em 8%: o que registro?', 'Se a carga ficar abaixo de 8%, registre o valor.'))
        self.assertTrue(numeric_premises_supported('Esperei 120 segundos.', 'Espere dois minutos.'))
        self.assertFalse(numeric_premises_supported('Esperei 120 dias.', 'Espere dois minutos.'))

    def test_third_blind_round_is_preserved_as_revealed_regression(self):
        # Independent result before disclosure: 25/30 (13/18 positive, 12/12 negative).
        # Later fixes use this disclosed fixture; they are not a new blind result.
        cases = json.loads((DATA/'revealed-third-holdout-cases.json').read_text(encoding='utf-8-sig'))
        for case in cases:
            with self.subTest(case=case['id']):
                result = answer(self.index, case['query'], use_model=False)
                self.assertEqual([row['id'] for row in result['evidence']],
                                 [case['expected']] if case['expected'] else [])
                self.assertEqual(result['state'], 'answered' if case['expected'] else 'abstained')
                for fact in case.get('facts', []):
                    self.assertIn(fact, result['answer'])

    def test_procedures_states_and_conditional_duration_follow_changed_source(self):
        for state, condition, priority in [('retido', 'o alerta permanecer ativo', 'P4'),
                                           ('em quarentena', 'a equipe concluir a inspeção', 'P7')]:
            conjunction = 'enquanto' if state == 'retido' else 'até que'
            text = (f'Ao devolver o tablet avariado, marque o tablet como “{state}”. '
                    'Gere a imagem de diagnóstico sem dados de pacientes. '
                    f'O operador publica o boletim {conjunction} {condition}. '
                    f'A falha do scanner com contorno recebe prioridade {priority}.')
            index = Index(manual(text))
            for query, fact in [
                ('Que cuidado devo tomar com dados de pacientes na imagem de diagnóstico?', 'sem dados de pacientes'),
                ('Qual é o estado que devo marcar no tablet devolvido com defeito?', state),
                ('Qual o status do tablet avariado?', state),
                ('Por quanto tempo deve continuar o boletim?', condition),
                ('A falha do scanner tem contorno. Qual prioridade aplicar?', priority),
            ]:
                with self.subTest(query=query, state=state):
                    result = answer(index, query, use_model=False)
                    self.assertEqual(result['state'], 'answered')
                    self.assertEqual(result['answer'], text)
                    self.assertIn(fact, result['answer'])
            for query in [
                'Qual o estado do scanner?',
                'Qual o estado do tablet e qual o custo de reparo?',
                'Por quanto tempo deve continuar a garantia do tablet?',
                'Que cuidado devo tomar com a embalagem do tablet?',
                'Qual o status “liberado” do tablet avariado?',
                'Qual a prioridade e o prazo para resolver a falha do scanner?',
            ]:
                with self.subTest(query=query, state=state):
                    self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')

    def test_calendar_fields_require_both_day_and_clock_in_source(self):
        for day, clock, other in [('terça-feira', '08h às 09h', 'sábado'),
                                  ('sábado', '14:30 às 16:00', 'terça-feira')]:
            text = f'A manutenção do laboratório ocorre na {day}, das {clock}, no horário de Brasília.'
            index = Index(manual(text))
            for query in ['A manutenção do laboratório é em qual dia e horário?',
                          'Qual o dia da manutenção do laboratório?',
                          f'A manutenção do laboratório na {day} tem qual horário?']:
                with self.subTest(query=query, day=day):
                    result = answer(index, query, use_model=False)
                    self.assertEqual(result['state'], 'answered')
                    self.assertIn(day, result['answer'])
                    self.assertIn(clock, result['answer'])
            for query in [f'A manutenção do laboratório no {other} tem qual horário?',
                          'Qual o dia e o custo da manutenção do laboratório?']:
                with self.subTest(query=query, day=day):
                    self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')
        for text in ['A manutenção do laboratório ocorre na terça-feira.',
                     'A manutenção do laboratório ocorre das 08h às 09h.']:
            with self.subTest(missing_field=text):
                index = Index(manual(text))
                self.assertEqual(answer(index, 'A manutenção do laboratório é em qual dia e horário?', use_model=False)['state'], 'abstained')

    def test_nominal_notices_and_assigned_states_do_not_invent_other_attributes(self):
        for text in ['O boletim do laboratório tem o título “em reparo”. O tablet está no balcão.',
                     'Registre o estado do tablet no relatório. O boletim fica no balcão.']:
            index = Index(manual(text))
            for query in ['Qual o estado do tablet?', 'Por quanto tempo deve continuar o boletim?']:
                with self.subTest(query=query, source=text):
                    self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')

    def test_new_corpus_paraphrases_keep_procedures_and_refuse_absent_attributes(self):
        for label, limit, room in [('Âmbar', 8, 'C4'), ('Turmalina', 27, 'B7')]:
            docs = manual(
                f'Quando o painel da máquina {label} indicar carga em {limit}% ou menos, '
                f'registre o lote da bateria e encaminhe a unidade usada ao armário {room}. '
                'O responsável técnico recebe o aviso da troca.', ident=f'FIXTURE-{limit}')
            docs[0]['title'] = f'Manutenção da máquina {label}'
            docs[0]['sections'][0]['heading'] = 'Carga e substituição'
            index = Index(docs)
            for query, facts in [
                (f'A máquina {label} chegou a {limit-1}% de carga. O que devo registrar depois da troca?', ['lote da bateria', room]),
                (f'A carga da máquina {label} está baixa. Quem precisa ser avisado?', ['responsável técnico', 'aviso']),
                (f'Qual identificação devo anotar na troca da bateria da máquina {label}?', ['lote da bateria']),
            ]:
                with self.subTest(query=query):
                    result = answer(index, query, use_model=False)
                    self.assertEqual(result['state'], 'answered')
                    for fact in facts:
                        self.assertIn(fact, result['answer'])
            for query in [
                f'A máquina {label} está a {limit+1}% de carga. O que registro na troca?',
                f'Qual a marca da bateria da máquina {label}?',
                f'Quem é o fabricante da máquina {label}?',
                f'Onde fica a bateria e quanto custou a compra da máquina {label}?',
                f'Qual o prazo contratual para substituir a bateria da máquina {label}?',
            ]:
                with self.subTest(query=query):
                    self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')

    def test_uppercase_sentence_starts_are_not_entity_assertions_but_ids_are(self):
        text = ('A rede Âmbar e a rede Jaspe atendem o laboratório. Quando as duas redes falham, '
                'o responsável técnico recebe um aviso. Use a entrada HDMI 3 do projetor da sala A4.')
        index = Index(manual(text))
        for query in ['A rede Âmbar e a rede Jaspe falharam. Quem precisa ser avisado?',
                      'A rede Âmbar falhou. Qual entrada HDMI uso no projetor?']:
            with self.subTest(query=query):
                self.assertEqual(answer(index, query, use_model=False)['state'], 'answered')
        for query in ['Qual entrada uso no projetor da sala A5?',
                      'Qual entrada HDMI 2 uso no projetor?',
                      'A rede Âmbar falhou. Quem é o fabricante do projetor?']:
            with self.subTest(query=query):
                self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')

    def test_complete_evidence_is_checked_beyond_the_three_nearest_candidates(self):
        docs = manual('O projetor usa a entrada HDMI 4. Confira o cabo antes da aula.')
        docs[0]['sections'] = [dict(id=f'distractor-{i}', heading='Projetor e HDMI',
            text='O projetor usa a entrada HDMI 4. Confira o cabo antes da aula.') for i in range(4)]
        complete = 'A marca do projetor é Aroeira. A entrada do projetor é HDMI 4.'
        docs[0]['sections'].append(dict(id='complete', heading='Ficha do projetor', text=complete))
        index = Index(docs)
        # Force the complete passage below all four similar-but-incomplete hits;
        # this tests the selection boundary, not a claimed retrieval benchmark.
        with patch.object(index.store, 'rank', return_value=[(i, .9-i*.1) for i in range(4)] + [(4, .11)]):
            result = answer(index, 'Qual a marca do projetor e qual entrada HDMI ele usa?', use_model=False)
        self.assertEqual(result['state'], 'answered')
        self.assertEqual(result['answer'], complete)
        self.assertEqual(result['evidence'][0]['id'], 'TEST-NEW#complete')

    def test_temporal_purpose_and_field_modifiers_belong_to_the_evidence(self):
        text = ('O prazo para confirmar o recebimento de um incidente P3 é de 7 minutos. '
                'O prazo máximo para resolver definitivamente o incidente P3 é de 45 minutos. '
                'O código comercial do cartucho é AZ-902. O código patrimonial da impressora é AT-41.')
        index = Index(manual(text))
        for query, fact in [
            ('Qual o tempo máximo para resolver definitivamente um incidente P3?', '45 minutos'),
            ('Qual o prazo para confirmar recebimento de um incidente P3?', '7 minutos'),
            ('Qual é o código comercial do cartucho?', 'AZ-902'),
            ('Qual é o código patrimonial da impressora?', 'AT-41'),
        ]:
            with self.subTest(query=query):
                result = answer(index, query, use_model=False)
                self.assertEqual(result['state'], 'answered')
                self.assertIn(fact, result['answer'])
        for query in ['Qual o código comercial da impressora?',
                      'Qual o prazo para substituir a impressora?']:
            with self.subTest(query=query):
                self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')

    def test_missing_role_or_action_in_other_interrogatives_is_not_inferred(self):
        for query in ['Quem é o fabricante do projetor que usa o cabo HDMI da mesa?',
                      'Quando termina a garantia da impressora da secretaria?']:
            with self.subTest(query=query):
                self.assertEqual(answer(self.index, query, use_model=False)['state'], 'abstained')
        index = Index(manual('O fabricante do projetor é Acácia. A garantia da impressora termina em março de 2029.'))
        for query in ['Quem é o fabricante do projetor?', 'Quando termina a garantia da impressora?']:
            with self.subTest(query=query):
                self.assertEqual(answer(index, query, use_model=False)['state'], 'answered')

    def test_model_cannot_choose_an_incomplete_or_unrelated_candidate(self):
        query = 'Qual é a marca do projetor que usa o cabo HDMI?'
        with patch.dict('os.environ', {'LLM_BASE_URL':'http://unused.invalid','LLM_MODEL':'fixture'}), \
             patch('search.model_json', return_value={'id':'RB-03#s1','quote':self.index.passages[5].text}):
            self.assertEqual(answer(self.index, query)['state'], 'abstained')

    def test_context_never_supplies_fields_for_a_different_passage(self):
        docs = manual('O projetor do laboratório Aurora usa a entrada HDMI 2.')
        docs[0]['sections'].append({'id':'scanner', 'heading':'Scanner',
                                   'text':'A marca do scanner é Cedrinho. A garantia do scanner dura 90 dias.'})
        index = Index(docs)
        for query in ('Qual é a marca do projetor HDMI?', 'Quanto tempo dura a garantia do projetor HDMI?'):
            with self.subTest(query=query):
                self.assertEqual(answer(index, query, use_model=False)['state'], 'abstained')
