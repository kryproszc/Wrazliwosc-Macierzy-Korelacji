# 1. Udziały typów rent — przejmujemy z arkusza
udzialy_data <- readxl::read_excel(file, sheet = "udzialy rent")

s4 <- as.data.frame(sev_data[sev_data$LOB == "LOB_4", ])
u4 <- as.data.frame(udzialy_data[
  udzialy_data$LOB == "LOB_4", ])

s4 <- s4[order(s4$typ), ]
p <- u4$udzial[match(s4$typ, u4$typ)]

stopifnot(
  !anyNA(p),
  abs(sum(p) - 1) < 1e-5,
  all(s4$distr_name == "LogNormal")
)

# Średnia roczna kwota renty — parametry lognormalne
s4$srednia_roczna <- exp(s4$mu + s4$sigma^2 / 2)
s4$udzial <- p


# 2. Profil zgłoszeń — okresy 1, 2, ..., 26
v4 <- as.data.frame(v_data[v_data$LOB == "LOB_4", ])
stopifnot(nrow(v4) == 1)

j <- sort(as.integer(setdiff(names(v4), "LOB")))
bf <- as.numeric(unlist(v4[1, as.character(j)]))

stopifnot(
  identical(j, seq_along(j)),
  all(is.finite(bf)),
  all(bf >= 0),
  abs(sum(bf) - 1) < 1e-5
)


# 3. Okresy płatności i czynniki dyskontowe
kolumny <- grep("^okres[0-9]+$", names(omega_data), value = TRUE)
l <- as.integer(sub("okres", "", kolumny))
kolumny <- kolumny[order(l)]
l <- sort(l)

stopifnot(identical(l, seq_along(l)))

DF <- df_data[["DF(T)"]]

if (length(DF) < length(l)) {
  stop("Za mało czynników DF względem liczby okresów omega.")
}

DF <- DF[seq_along(l)]
stopifnot(all(is.finite(DF)))


# 4. Oczekiwane płatności jednej renty w kolejnych okresach
# Kolumny macierzy: typy rent; wiersze: okresy płatności
platnosci_typ <- matrix(
  0,
  nrow = length(l),
  ncol = nrow(s4),
  dimnames = list(l, s4$typ)
)

for (a in seq_len(nrow(s4))) {

  om <- as.data.frame(omega_data[
    omega_data$LOB == "LOB_4" &
    omega_data$typ == s4$typ[a],
  ])

  stopifnot(!anyDuplicated(om$m))

  pozycje <- match(j, om$m)
  if (anyNA(pozycje)) stop("Brakuje okresu zgłoszenia w omega.")

  O <- as.matrix(om[pozycje, kolumny, drop = FALSE])
  storage.mode(O) <- "double"

  # Przed zgłoszeniem nie występują płatności
  przed_zgloszeniem <- outer(j, l, ">")
  O[przed_zgloszeniem] <- 0

  # Braki po zgłoszeniu wymagają wyjaśnienia
  if (any(!is.finite(O))) {
    stop("Brakuje wartości omega po okresie zgłoszenia.")
  }

  platnosci_typ[, a] <-
    s4$srednia_roczna[a] * as.numeric(bf %*% O)
}

# Średnia płatność jednej renty, po uwzględnieniu typów
platnosci <- as.numeric(platnosci_typ %*% p)

srednia_undisc <- sum(platnosci)
srednia_disc   <- sum(platnosci * DF)


# 5. Oczekiwane liczby rent — nasze wcześniejsze wyniki
n_hrg <- c(
  "4K_MTPL" = 25.3803016402820,
  "4M_GC" = 2.32498355528391,
  "4M_MTPL" = 162.87308873132966
)

# Planowana składka zarobiona dla 2025
plan <- as.data.frame(exposure_data[
  exposure_data$YEAR == 2025 &
  exposure_data$HRG %in% names(n_hrg),
])

stopifnot(!anyDuplicated(plan$HRG))

skladka <- plan$EARNED_PREMIUM[
  match(names(n_hrg), plan$HRG)
]

stopifnot(all(is.finite(skladka)), all(skladka > 0))

LR_odtw <- data.frame(
  LOB = 4,
  HRG = names(n_hrg),
  ann_sum_undisc = as.numeric(n_hrg) * srednia_undisc,
  ann_sum_disc = as.numeric(n_hrg) * srednia_disc,
  earned_premium_plan = skladka
)

LR_odtw$LR_undisc <-
  LR_odtw$ann_sum_undisc / LR_odtw$earned_premium_plan

LR_odtw$LR_disc <-
  LR_odtw$ann_sum_disc / LR_odtw$earned_premium_plan

print(s4, digits = 15, row.names = FALSE)
print(LR_odtw, digits = 15, row.names = FALSE)
