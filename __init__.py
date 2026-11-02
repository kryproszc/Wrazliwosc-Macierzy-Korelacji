kontrola_gc <- hist4 %>%
  filter(HRG == "4M_GC", i >= 2007, i <= 2024) %>%
  select(i, EARNED_RISK) %>%
  left_join(
    number4 %>%
      filter(HRG == "4M_GC") %>%
      select(i, N_hrg_ult),
    by = "i"
  ) %>%
  arrange(i)

print(kontrola_gc, n = Inf)
