library(readxl)

# Plik z wynikami modelu GAMLSS
plik_model <- file.choose()

freq <- read_excel(plik_model, sheet = "FREQ_predictions")
sev  <- read_excel(plik_model, sheet = "SEV_predictions")

# Plik z danymi wejściowymi
plik_dane <- file.choose()

u <- read_excel(plik_dane, sheet = "u")
w <- read_excel(plik_dane, sheet = "w")

# Sprawdzenie struktury
head(freq)
head(sev)
head(u)
head(w)


# Parametry
rok <- 2000
a <- 26
i <- rok - 1999 + 1

# Przyszłe okresy zgłoszeń
j_start <- a - i + 2

# Liczby zgłoszeń
freq_rok <- subset(freq, i == rok & j >= j_start & j <= a)

# Kwoty rocznych rent
sev_rok <- subset(sev, i == rok)

# Współczynniki wypłacalności
w_rok <- subset(w, i == rok)

# Obliczenie BE
bel <- 0

for (k in seq_len(nrow(freq_rok))) {

  j <- freq_rok$j[k]
  N <- freq_rok$N_model[k]

  # Indeks okresu przyszłego zgłoszenia
  m <- j - (a - i + 1)

  for (r in sev_rok$r) {

    Y <- sev_rok$Y_model[sev_rok$r == r]
    udzial <- u$u[u$r == r]

    # Hipoteza indeksowania:
    # m = okres zgłoszenia, l = okres wypłaty
    w_wybrane <- subset(
      w_rok,
      w_rok$r == r & w_rok$m == m & w_rok$l >= m
    )

    suma_w <- sum(w_wybrane$w)

    bel <- bel + N * udzial * Y * suma_w
  }
}

cat("BE 2000 - model:", bel, "\n")
cat("BE 2000 - Excel:", 2274034.142, "\n")
cat("Różnica:", bel - 2274034.142, "\n")
