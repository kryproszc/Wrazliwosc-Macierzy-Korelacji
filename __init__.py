library(dplyr)
library(gamlss)

# ============================================================
# 1. USTAWIENIA
# ============================================================

start_year <- 1999
end_year   <- 2024

a <- end_year - start_year + 1

# Dane do predykcji Frequency
freq_train <- as.data.frame(
  freq[, c("i", "j", "N")]
)

# ============================================================
# 2. PRZYSZŁE KOMÓRKI TRÓJKĄTA - IBNYR
# ============================================================

future_freq <- expand.grid(
  i = start_year:end_year,
  j = 1:a
)

# Numer roku szkody w dokumentacji: 1,...,a
future_freq$i_index <- future_freq$i - start_year + 1

# Wybieramy tylko przyszłe zgłoszenia
future_freq <- future_freq[
  future_freq$j >= a - future_freq$i_index + 2,
]

future_freq <- future_freq[
  order(future_freq$i, future_freq$j),
]

# Okres przyszłego zgłoszenia:
# m = 1 oznacza pierwszy przyszły rok
future_freq$m <- with(
  future_freq,
  j - (end_year - i + 1)
)

# Techniczna kolumna N do predykcji GAMLSS
future_freq$N <- 0

cat("Liczba przyszłych komórek:",
    nrow(future_freq), "\n")

# ============================================================
# 3. FREQUENCY - OCZEKIWANA LICZBA ZGŁOSZEŃ
# ============================================================

future_freq$N_model <- as.numeric(
  predict(
    model_freq,
    newdata = as.data.frame(
      future_freq[, c("i", "j", "N")]
    ),
    data = freq_train,
    what = "mu",
    type = "response"
  )
)

stopifnot(
  all(is.finite(future_freq$N_model)),
  all(future_freq$N_model >= 0)
)

# ============================================================
# 4. UDZIAŁY TYPÓW RENT
# ============================================================

u_data <- as.data.frame(ann_type_split)

names(u_data) <- c("r", "u")

stopifnot(
  !anyNA(u_data),
  !anyDuplicated(u_data$r),
  abs(sum(u_data$u) - 1) < 1e-6
)

# Przypisujemy udziały do przyszłych zgłoszeń
future_rents <- merge(
  future_freq,
  u_data,
  by = NULL
)

# Oczekiwana liczba rent danego typu
future_rents$N_r <- with(
  future_rents,
  N_model * u
)

# ============================================================
# 5. SEVERITY - OCZEKIWANA ROCZNA KWOTA RENTY
# ============================================================

# Korzystamy z 52 prognoz z dopasowanego modelu
# Severity, które wcześniej odtworzyliśmy.

severity_predictions <- as.data.frame(
  wyniki_sev[, c("r", "i", "Y_model")]
)

stopifnot(
  !anyDuplicated(severity_predictions[, c("r", "i")])
)

future_rents <- merge(
  future_rents,
  severity_predictions,
  by = c("r", "i"),
  all.x = TRUE,
  sort = FALSE
)

if (anyNA(future_rents$Y_model)) {
  stop("Brakuje prognoz Severity dla części lat lub typów rent.")
}

# ============================================================
# 6. OCZEKIWANA ROCZNA WARTOŚĆ ROSZCZEŃ
# ============================================================

future_rents$Expected_annual <- with(
  future_rents,
  N_r * Y_model
)

# ============================================================
# 7. WSPÓŁCZYNNIKI WYPŁACALNOŚCI RENT
# ============================================================

w_data <- as.data.frame(weights_data)

stopifnot(
  all(c("r", "i", "l", "m", "w") %in% names(w_data)),
  !anyNA(w_data),
  !anyDuplicated(w_data[, c("r", "i", "l", "m")])
)

# Łączymy przyszłe zgłoszenia z odpowiadającymi
# im współczynnikami wypłacalności.
#
# Założenie do weryfikacji:
# m - okres przyszłego zgłoszenia
# l - okres przyszłej wypłaty

cashflows <- merge(
  future_rents,
  w_data,
  by = c("r", "i", "m"),
  all.x = TRUE,
  sort = FALSE
)

# Nie wolno po cichu zastępować brakujących wag zerami.
if (anyNA(cashflows$w)) {
  stop(
    "Brak współczynników w dla części przyszłych zgłoszeń."
  )
}

# Wypłaty nie wcześniej niż okres zgłoszenia
cashflows <- cashflows[
  cashflows$l >= cashflows$m,
]

# ============================================================
# 8. OCZEKIWANE PRZYSZŁE PRZEPŁYWY
# ============================================================

cashflows$Expected_payment <- with(
  cashflows,
  Expected_annual * w
)

# ============================================================
# 9. REZERWA IBNYR BE - BEZ DYSKONTOWANIA
# ============================================================

BE_undiscounted <- sum(
  cashflows$Expected_payment
)

# Wyniki według roku szkody
BE_by_year <- cashflows %>%
  group_by(i) %>%
  summarise(
    BE = sum(Expected_payment),
    .groups = "drop"
  )

# Wyniki według typu renty
BE_by_type <- cashflows %>%
  group_by(r) %>%
  summarise(
    BE = sum(Expected_payment),
    .groups = "drop"
  )

# ============================================================
# 10. DYSKONTOWANIE
# ============================================================

d_data <- as.data.frame(discount_factors)

names(d_data) <- c("l", "d")

stopifnot(
  !anyNA(d_data),
  !anyDuplicated(d_data$l)
)

cashflows <- merge(
  cashflows,
  d_data,
  by = "l",
  all.x = TRUE,
  sort = FALSE
)

if (anyNA(cashflows$d)) {
  stop("Brakuje czynników dyskontowych dla części wypłat.")
}

cashflows$Discounted_payment <- with(
  cashflows,
  Expected_payment * d
)

BE_discounted <- sum(
  cashflows$Discounted_payment
)

# ============================================================
# 11. WYNIKI KOŃCOWE
# ============================================================

cat("\n====================================\n")
cat("      REZERWA RENTOWA IBNYR\n")
cat("====================================\n")

cat(
  "Liczba przyszłych komórek:",
  nrow(future_freq), "\n"
)

cat(
  "Oczekiwana liczba zgłoszeń:",
  sum(future_freq$N_model), "\n"
)

cat(
  "BE bez dyskontowania:",
  format(BE_undiscounted,
         big.mark = " ",
         scientific = FALSE),
  "\n"
)

cat(
  "BE po dyskontowaniu:",
  format(BE_discounted,
         big.mark = " ",
         scientific = FALSE),
  "\n"
)

cat("\nBE według roku szkody:\n")
print(BE_by_year, n = Inf)

cat("\nBE według typu renty:\n")
print(BE_by_type, n = Inf)
