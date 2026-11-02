library(dplyr)

wybrany_hrg <- "4K_MTPL"

# 1–4. Dane o zgłoszeniach i odtworzenie ultimate HRG
krok2 <- number4 %>%
  filter(HRG == wybrany_hrg) %>%
  arrange(i)

# Dokumentacja nie określa wzoru dla zerowego mianownika
stopifnot(
  nrow(krok2) > 0,
  !anyDuplicated(krok2$i),
  all(is.finite(krok2$N_lob_hist)),
  all(krok2$N_lob_hist > 0)
)

krok2 <- krok2 %>%
  mutate(
    przyszle_LOB = N_lob_ult - N_lob_hist,
    udzial_HRG = N_hrg_hist / N_lob_hist,

    N_ult_odtw = N_hrg_hist + przyszle_LOB * udzial_HRG,

    # Porównanie z Excelem
    roznica_Excel = N_ult_odtw - N_hrg_ult
  )

# 5. Dołączenie ekspozycji tego samego HRG według roku
ekspozycja_hrg <- hist4 %>%
  filter(HRG == wybrany_hrg) %>%
  select(i, EARNED_RISK)

stopifnot(!anyDuplicated(ekspozycja_hrg$i))

krok2 <- krok2 %>%
  left_join(ekspozycja_hrg, by = "i") %>%
  mutate(
    czestosc = N_ult_odtw / EARNED_RISK
  )

print(
  as.data.frame(krok2 %>%
    select(i, N_hrg_hist, przyszle_LOB, udzial_HRG,
           N_ult_odtw, N_hrg_ult, roznica_Excel,
           EARNED_RISK, czestosc)),
  digits = 15,
  row.names = FALSE
)
