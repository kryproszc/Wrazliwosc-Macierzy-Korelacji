wyniki_sev <- unique(
  sev[, c("r", "i", "Y_model")]
)

wyniki_sev <- wyniki_sev[
  order(wyniki_sev$r, wyniki_sev$i),
]

print(wyniki_sev, n = 52, digits = 12)
