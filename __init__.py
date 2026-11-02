# 1. Dyspersja oszacowana dla LOB — jak w kolumnach Excela
# Nie zmieniamy parametrów rozkładów ani odchyleń.

wyniki_krok3 <- wyniki_krok3 %>%
  mutate(
    `Dyspersja HRG` = D_lob4,
    `Dyspersja LOB` = D_lob4
  )

# 2. Częstość LOB wynikająca z końcowych częstości HRG

E_lob4_z_hrg <- with(
  baza_krok3,
  sum(E_k * W_k) / sum(W_k)
)

porownanie_E_LOB <- data.frame(
  E_LOB_z_kroku1 = E_lob4,
  E_LOB_z_HRG = E_lob4_z_hrg
)

print(porownanie_E_LOB, digits = 15, row.names = FALSE)

# 3. Podgląd poprawionej tabeli
View(wyniki_krok3)
