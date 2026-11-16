# Segundo fator administrativo

A configuração é individual e voluntária até confirmação pelo titular: Admin → Proteger minha conta com segundo fator. Não há alteração automática do autenticador de contas reais.

- Autenticador TOTP compatível com RFC 6238, SHA1, seis dígitos, intervalo de 30 segundos e tolerância de um intervalo.
- Chave manual para adicionar a conta no autenticador. Nenhum serviço externo recebe a chave para gerar QR.
- A configuração exige senha atual ou sessão Google recente de até cinco minutos para conta sem senha, e confirmação de um código. A tentativa expira em dez minutos e fica vinculada à sessão que iniciou.
- Senha e Google seguem o mesmo bloqueio de segundo fator depois de ativado. Antes de confirmar, a sessão só pode consultar o próprio perfil/estado MFA, confirmar MFA ou sair; não acessa dados financeiros nem admin. A confirmação de login expira em cinco minutos.
- Ativação e troca invalidam outras sessões. Logout e alteração de senha continuam a revogar sessões; redefinir senha não remove MFA.
- Dez códigos de recuperação aleatórios de 80 bits, exibidos uma única vez e armazenados como hashes. Uso e proteção contra repetição TOTP são atômicos. Cinco tentativas por conta em quinze minutos, persistidas no banco, além do limite por IP/rota.
- Troca do autenticador exige MFA recente e nova configuração confirmada. O autenticador antigo funciona até confirmar o novo; códigos de recuperação antigos são substituídos na confirmação.
- Semente criptografada com AES-256-GCM e chave derivada por HKDF do segredo JWT existente, com contexto exclusivo para MFA. Rotacionar JWT_SECRET também muda a chave de leitura: planejar reconfiguração do autenticador usando códigos de recuperação. Não rotacionar sem procedimento de recuperação.
- Credenciais ficam em coleção própria e não integram exportações de clientes ou snapshots financeiros; são removidas na exclusão da conta.

O titular deve guardar os códigos antes de sair. Se perder autenticador e todos os códigos, a recuperação requer procedimento operacional verificado; não há botão administrativo que remova o fator de outra pessoa. Não foi adicionada obrigatoriedade global para administradores ainda sem configuração nem proteção de passkeys contra phishing.

Referências: https://www.rfc-editor.org/rfc/rfc6238 e https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html.
