if wagi is None:
    W = pd.DataFrame(
        1.0,
        index=cumulative_df.index,
        columns=cumulative_df.columns,
    )
else:
    W = pd.DataFrame(
        wagi,
        index=cumulative_df.index,
        columns=cumulative_df.columns,
        dtype=float,
    )
