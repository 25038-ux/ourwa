/// LE NUMÉRO MAURITANIEN — la même règle que `@elourwa/shared/telephone` :
/// huit chiffres commençant par 2, 3 ou 4 ; l'indicatif +222 (ou 00222) est
/// admis et retiré ; espaces, tirets, parenthèses ignorés. La forme canonique
/// est les huit chiffres.
final RegExp _mauritanien = RegExp(r'^[234][0-9]{7}$');

String? telephoneMauritanien(String? brut) {
  if (brut == null) return null;
  var chiffres = brut.replaceAll(RegExp(r'[^0-9+]'), '');
  if (chiffres.startsWith('+')) chiffres = chiffres.substring(1);
  if (chiffres.startsWith('00222')) {
    chiffres = chiffres.substring(5);
  } else if (chiffres.startsWith('222') && chiffres.length == 11) {
    chiffres = chiffres.substring(3);
  }
  return _mauritanien.hasMatch(chiffres) ? chiffres : null;
}
